import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { schema } from "@business-os/db";
import {
  REFRESH_TOKEN_TTL_DAYS,
  type ClientPrincipal,
  type RlsContext,
} from "@business-os/shared";
import { and, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../../common/audit/audit.service.js";
import { EncryptionService } from "../../../common/crypto/encryption.service.js";
import { DbService } from "../../../common/db/db.service.js";
import { PasswordService } from "../../../common/auth/password.service.js";
import { TotpService } from "../../../common/auth/totp.service.js";
import { ClientTokenService } from "./client-token.service.js";

export interface ClientTokenPair {
  accessToken: string;
  refreshToken: string;
}

function slidingExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Client-portal authentication (Module 18). A client_account is admin-provisioned
 * (no self-register here) and maps 1:1 to a client party. Mirrors the business/PF
 * auth discipline (rotation + reuse-detection, sealed 2FA, fail-closed) but its DB
 * work runs under the BUSINESS RLS context scoped to the client party — the data
 * is business data, read only through caller-guarded definers.
 */
@Injectable()
export class ClientAuthService {
  private readonly logger = new Logger(ClientAuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: ClientTokenService,
    private readonly crypto: EncryptionService,
    private readonly audit: AuditService,
  ) {}

  private ctxOf(p: { orgId: string; partyId: string }): RlsContext {
    return { orgId: p.orgId, partyId: p.partyId, isSuperadmin: false };
  }

  async login(
    loginId: string,
    password: string,
    totp?: string,
    deviceLabel?: string,
  ): Promise<ClientTokenPair | { resetRequired: true }> {
    const row = await this.db.clientAuthLookup(loginId);
    if (!row) {
      this.logger.warn("Client login failed: unknown login id");
      throw new UnauthorizedException("Invalid credentials");
    }
    const ctx = this.ctxOf({ orgId: row.org_id, partyId: row.party_id });
    const fail = async (reason: string): Promise<never> => {
      await this.db
        .withTenant(ctx, (tx) =>
          this.audit.record(tx, row.org_id, {
            actorUserId: null,
            action: "client.login_failed",
            entity: "client_account",
            entityId: row.id,
            detail: { reason },
          }),
        )
        .catch(() => undefined);
      throw new UnauthorizedException("Invalid credentials");
    };

    // Only active/invited/lead accounts may log in; deactivated can't.
    if (row.status !== "active" && row.status !== "invited" && row.status !== "lead") {
      return fail(`status:${row.status}`);
    }
    // An expired, unconverted lead is locked out immediately (not only at the
    // nightly purge) — upholds the stated "expired lead can't log in" guarantee.
    if (row.status === "lead" && row.expires_at && row.expires_at.getTime() < Date.now()) {
      return fail("lead_expired");
    }
    if (!(await this.passwords.verify(password, row.password_hash))) return fail("password");
    if (row.twofa_secret) {
      let plaintext: string;
      try {
        ({ plaintext } = this.crypto.open(row.twofa_secret));
      } catch {
        return fail("totp_unreadable");
      }
      if (!totp || !this.totp.verify(totp, plaintext)) return fail("totp");
    }
    // Forced first-login reset (0040): credentials are correct, but an auto-provisioned
    // account must reset its derivable initial password before any session is issued.
    // Checked AFTER password+2FA so the signal never leaks that an account exists.
    if (row.must_reset_password) {
      await this.db
        .withTenant(ctx, (tx) =>
          this.audit.record(tx, row.org_id, {
            actorUserId: null,
            action: "client.login_reset_required",
            entity: "client_account",
            entityId: row.id,
            detail: null,
          }),
        )
        .catch(() => undefined);
      return { resetRequired: true };
    }
    // First successful login flips an 'invited' account to 'active'.
    if (row.status === "invited") {
      await this.db.withTenant(ctx, (tx) =>
        tx.update(schema.clientAccount).set({ status: "active", updatedAt: new Date() }).where(eq(schema.clientAccount.id, row.id)),
      );
    }
    return this.issue({ clientAccountId: row.id, orgId: row.org_id, partyId: row.party_id }, deviceLabel, "client.login");
  }

  async refresh(refreshToken: string): Promise<ClientTokenPair> {
    const claims = this.tokens.verifyRefresh(refreshToken);
    const principal: ClientPrincipal = { clientAccountId: claims.sub, orgId: claims.orgId, partyId: claims.partyId };
    const presentedHash = this.tokens.hashToken(refreshToken);
    // CRITICAL: the reuse-detection family-revoke + audit MUST commit even though
    // we reject the request — so we never `throw` inside the tx (withTenant rolls
    // back on throw, which would undo the revocation). The callback returns an
    // outcome that always commits; the 401 is thrown OUTSIDE the transaction.
    const outcome = await this.db.withTenant(this.ctxOf(claims), async (tx): Promise<ClientTokenPair | null> => {
      const [row] = await tx
        .select()
        .from(schema.clientRefreshToken)
        .where(
          and(
            eq(schema.clientRefreshToken.tokenHash, presentedHash),
            eq(schema.clientRefreshToken.clientAccountId, claims.sub),
          ),
        );
      if (!row) return null;
      // Reuse of a revoked token → revoke the whole family + audit (and COMMIT it).
      if (row.revokedAt) {
        await tx
          .update(schema.clientRefreshToken)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.clientRefreshToken.clientAccountId, claims.sub), isNull(schema.clientRefreshToken.revokedAt)));
        await this.audit.record(tx, claims.orgId, {
          actorUserId: null,
          action: "client.refresh_reuse_detected",
          entity: "client_refresh_token",
          entityId: row.id,
          detail: { clientAccountId: claims.sub },
        });
        return null;
      }
      if (row.expiresAt.getTime() <= Date.now()) return null;
      const revoked = await tx
        .update(schema.clientRefreshToken)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.clientRefreshToken.id, row.id), isNull(schema.clientRefreshToken.revokedAt)))
        .returning({ id: schema.clientRefreshToken.id });
      if (revoked.length === 0) return null;

      const accessToken = this.tokens.signAccess(principal);
      const { token: newRefresh } = this.tokens.signRefresh(principal);
      await tx.insert(schema.clientRefreshToken).values({
        clientAccountId: claims.sub,
        tokenHash: this.tokens.hashToken(newRefresh),
        deviceLabel: row.deviceLabel,
        expiresAt: slidingExpiry(),
        lastUsedAt: new Date(),
      });
      await this.audit.record(tx, claims.orgId, {
        actorUserId: null,
        action: "client.token_refreshed",
        entity: "client_refresh_token",
        entityId: row.id,
        detail: { clientAccountId: claims.sub },
      });
      return { accessToken, refreshToken: newRefresh };
    });
    if (!outcome) throw new UnauthorizedException("Invalid or expired refresh token");
    return outcome;
  }

  async logout(refreshToken: string): Promise<void> {
    const claims = this.tokens.verifyRefresh(refreshToken);
    const presentedHash = this.tokens.hashToken(refreshToken);
    await this.db.withTenant(this.ctxOf(claims), async (tx) => {
      const res = await tx
        .update(schema.clientRefreshToken)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.clientRefreshToken.tokenHash, presentedHash), isNull(schema.clientRefreshToken.revokedAt)))
        .returning({ id: schema.clientRefreshToken.id });
      await this.audit.record(tx, claims.orgId, {
        actorUserId: null,
        action: "client.logout",
        entity: "client_refresh_token",
        entityId: res[0]?.id ?? null,
        detail: { clientAccountId: claims.sub },
      });
    });
  }

  async enroll2fa(principal: ClientPrincipal): Promise<{ secret: string; otpauthUrl: string }> {
    const loginId = await this.db.withTenant(this.ctxOf(principal), async (tx) => {
      const [a] = await tx
        .select({ loginId: schema.clientAccount.loginId })
        .from(schema.clientAccount)
        .where(eq(schema.clientAccount.id, principal.clientAccountId));
      return a?.loginId ?? principal.clientAccountId;
    });
    const secret = this.totp.generateSecret();
    return { secret, otpauthUrl: this.totp.keyUri(loginId, secret) };
  }

  async enable2fa(principal: ClientPrincipal, secret: string, code: string): Promise<void> {
    if (!this.totp.verify(code, secret)) throw new BadRequestException("Invalid 2FA code");
    await this.db.withTenant(this.ctxOf(principal), async (tx) => {
      await tx
        .update(schema.clientAccount)
        .set({ twofaSecret: this.crypto.seal(secret), updatedAt: new Date() })
        .where(eq(schema.clientAccount.id, principal.clientAccountId));
      await this.audit.record(tx, principal.orgId, {
        actorUserId: null,
        action: "client.2fa_enabled",
        entity: "client_account",
        entityId: principal.clientAccountId,
        detail: null,
      });
    });
  }

  /** The signed-in client's own profile (queried by their OWN id — no cross-account read). */
  async profile(principal: ClientPrincipal) {
    return this.db.withTenant(this.ctxOf(principal), async (tx) => {
      const [a] = await tx
        .select({
          id: schema.clientAccount.id,
          loginId: schema.clientAccount.loginId,
          status: schema.clientAccount.status,
          twofaSecret: schema.clientAccount.twofaSecret,
          displayName: schema.party.displayName,
        })
        .from(schema.clientAccount)
        .leftJoin(schema.party, eq(schema.party.id, schema.clientAccount.partyId))
        .where(eq(schema.clientAccount.id, principal.clientAccountId));
      if (!a) throw new UnauthorizedException("Account not found");
      return {
        id: a.id,
        loginId: a.loginId,
        status: a.status,
        displayName: a.displayName,
        twofaEnabled: a.twofaSecret != null,
      };
    });
  }

  private async issue(principal: ClientPrincipal, deviceLabel: string | undefined, action: string): Promise<ClientTokenPair> {
    return this.db.withTenant(this.ctxOf(principal), async (tx) => {
      const accessToken = this.tokens.signAccess(principal);
      const { token: refreshToken } = this.tokens.signRefresh(principal);
      await tx.insert(schema.clientRefreshToken).values({
        clientAccountId: principal.clientAccountId,
        tokenHash: this.tokens.hashToken(refreshToken),
        deviceLabel: deviceLabel ?? null,
        expiresAt: slidingExpiry(),
        lastUsedAt: new Date(),
      });
      await this.audit.record(tx, principal.orgId, {
        actorUserId: null,
        action,
        entity: "client_account",
        entityId: principal.clientAccountId,
        detail: deviceLabel ? { deviceLabel } : null,
      });
      return { accessToken, refreshToken };
    });
  }
}
