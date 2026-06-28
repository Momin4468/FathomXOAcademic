import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { schema } from "@business-os/db";
import {
  REFRESH_TOKEN_TTL_DAYS,
  type PfPrincipal,
  type PfRlsContext,
} from "@business-os/shared";
import { and, eq, isNull } from "drizzle-orm";
import { EncryptionService } from "../../../common/crypto/encryption.service.js";
import { DbService } from "../../../common/db/db.service.js";
import { PasswordService } from "../../../common/auth/password.service.js";
import { TotpService } from "../../../common/auth/totp.service.js";
import { PfAuditService } from "../pf-audit.service.js";
import { PfTokenService } from "./pf-token.service.js";

export interface PfTokenPair {
  accessToken: string;
  refreshToken: string;
}

function slidingExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Personal-finance authentication (§11). A PF account is fully self-administered:
 * its own credentials, its own 2FA, its own rotating refresh tokens — independent
 * of any business user_account. Mirrors the business AuthService discipline
 * (rotation + reuse-detection, sealed 2FA, fail-closed) on the PF plane.
 */
@Injectable()
export class PfAuthService {
  private readonly logger = new Logger(PfAuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: PfTokenService,
    private readonly crypto: EncryptionService,
    private readonly audit: PfAuditService,
  ) {}

  /** Self-service registration. Seeds default categories (in the definer). */
  async register(email: string, password: string, displayName?: string, baseCurrency?: string): Promise<PfTokenPair> {
    const hash = await this.passwords.hash(password);
    const id = await this.db.pfRegister(email, hash, displayName ?? null, baseCurrency ?? "BDT");
    if (!id) throw new ConflictException("An account with this email already exists");
    return this.issue(id, undefined, "pf.registered");
  }

  async login(email: string, password: string, totp?: string, deviceLabel?: string): Promise<PfTokenPair> {
    const row = await this.db.pfAuthLookup(email);
    if (!row) {
      this.logger.warn("PF login failed: unknown email");
      throw new UnauthorizedException("Invalid credentials");
    }
    const fail = async (reason: string): Promise<never> => {
      await this.db
        .withPfAccount({ pfAccountId: row.id }, (tx) =>
          this.audit.record(tx, row.id, { action: "pf.login_failed", entity: "pf_account", entityId: row.id, detail: { reason } }),
        )
        .catch(() => undefined);
      throw new UnauthorizedException("Invalid credentials");
    };

    // status is PF-only — a deactivated brokerage account never lands here.
    if (row.status !== "active") return fail(`status:${row.status}`);
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
    return this.issue(row.id, deviceLabel, "pf.login");
  }

  /** Rotate: revoke the presented refresh token, issue a new pair (reuse = theft). */
  async refresh(refreshToken: string): Promise<PfTokenPair> {
    const claims = this.tokens.verifyRefresh(refreshToken);
    const ctx: PfRlsContext = { pfAccountId: claims.sub };
    const presentedHash = this.tokens.hashToken(refreshToken);
    return this.db.withPfAccount(ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.pfRefreshToken)
        .where(
          and(
            eq(schema.pfRefreshToken.tokenHash, presentedHash),
            eq(schema.pfRefreshToken.pfAccountId, claims.sub),
          ),
        );
      if (!row) throw new UnauthorizedException("Invalid or expired refresh token");
      // Reuse of a revoked token → revoke the whole family + audit.
      if (row.revokedAt) {
        await tx
          .update(schema.pfRefreshToken)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.pfRefreshToken.pfAccountId, claims.sub), isNull(schema.pfRefreshToken.revokedAt)));
        await this.audit.record(tx, claims.sub, { action: "pf.refresh_reuse_detected", entity: "pf_refresh_token", entityId: row.id });
        throw new UnauthorizedException("Invalid or expired refresh token");
      }
      if (row.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("Invalid or expired refresh token");
      const revoked = await tx
        .update(schema.pfRefreshToken)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.pfRefreshToken.id, row.id), isNull(schema.pfRefreshToken.revokedAt)))
        .returning({ id: schema.pfRefreshToken.id });
      if (revoked.length === 0) throw new UnauthorizedException("Invalid or expired refresh token");

      const principal: PfPrincipal = { pfAccountId: claims.sub };
      const accessToken = this.tokens.signAccess(principal);
      const { token: newRefresh } = this.tokens.signRefresh(principal);
      await tx.insert(schema.pfRefreshToken).values({
        pfAccountId: claims.sub,
        tokenHash: this.tokens.hashToken(newRefresh),
        deviceLabel: row.deviceLabel,
        expiresAt: slidingExpiry(),
        lastUsedAt: new Date(),
      });
      await this.audit.record(tx, claims.sub, { action: "pf.token_refreshed", entity: "pf_refresh_token", entityId: row.id });
      return { accessToken, refreshToken: newRefresh };
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const claims = this.tokens.verifyRefresh(refreshToken);
    const presentedHash = this.tokens.hashToken(refreshToken);
    await this.db.withPfAccount({ pfAccountId: claims.sub }, async (tx) => {
      const res = await tx
        .update(schema.pfRefreshToken)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.pfRefreshToken.tokenHash, presentedHash), isNull(schema.pfRefreshToken.revokedAt)))
        .returning({ id: schema.pfRefreshToken.id });
      await this.audit.record(tx, claims.sub, { action: "pf.logout", entity: "pf_refresh_token", entityId: res[0]?.id ?? null });
    });
  }

  /** Start 2FA enrollment — returns a secret + otpauth URL for a QR. */
  async enroll2fa(principal: PfPrincipal): Promise<{ secret: string; otpauthUrl: string }> {
    const email = await this.db.withPfAccount({ pfAccountId: principal.pfAccountId }, async (tx) => {
      const [a] = await tx.select({ email: schema.pfAccount.email }).from(schema.pfAccount).where(eq(schema.pfAccount.id, principal.pfAccountId));
      return a?.email ?? principal.pfAccountId;
    });
    const secret = this.totp.generateSecret();
    return { secret, otpauthUrl: this.totp.keyUri(email, secret) };
  }

  /** Confirm enrollment by verifying a code, then persist the sealed secret. */
  async enable2fa(principal: PfPrincipal, secret: string, code: string): Promise<void> {
    if (!this.totp.verify(code, secret)) throw new BadRequestException("Invalid 2FA code");
    await this.db.withPfAccount({ pfAccountId: principal.pfAccountId }, async (tx) => {
      await tx
        .update(schema.pfAccount)
        .set({ twofaSecret: this.crypto.seal(secret), updatedAt: new Date() })
        .where(eq(schema.pfAccount.id, principal.pfAccountId));
      await this.audit.record(tx, principal.pfAccountId, { action: "pf.2fa_enabled", entity: "pf_account", entityId: principal.pfAccountId });
    });
  }

  /** The signed-in account's own profile (incl. whether income is linked + 2FA on). */
  async profile(principal: PfPrincipal) {
    return this.db.withPfAccount({ pfAccountId: principal.pfAccountId }, async (tx) => {
      const [a] = await tx
        .select({
          id: schema.pfAccount.id,
          email: schema.pfAccount.email,
          displayName: schema.pfAccount.displayName,
          baseCurrency: schema.pfAccount.baseCurrency,
          linkedPartyId: schema.pfAccount.linkedPartyId,
          twofaSecret: schema.pfAccount.twofaSecret,
        })
        .from(schema.pfAccount)
        .where(eq(schema.pfAccount.id, principal.pfAccountId));
      if (!a) throw new UnauthorizedException("Account not found");
      return {
        id: a.id,
        email: a.email,
        displayName: a.displayName,
        baseCurrency: a.baseCurrency,
        linked: a.linkedPartyId != null,
        twofaEnabled: a.twofaSecret != null,
      };
    });
  }

  /** Issue a token pair + persist the refresh row + audit, in one pf transaction. */
  private async issue(pfAccountId: string, deviceLabel: string | undefined, action: string): Promise<PfTokenPair> {
    return this.db.withPfAccount({ pfAccountId }, async (tx) => {
      const principal: PfPrincipal = { pfAccountId };
      const accessToken = this.tokens.signAccess(principal);
      const { token: refreshToken } = this.tokens.signRefresh(principal);
      await tx.insert(schema.pfRefreshToken).values({
        pfAccountId,
        tokenHash: this.tokens.hashToken(refreshToken),
        deviceLabel: deviceLabel ?? null,
        expiresAt: slidingExpiry(),
        lastUsedAt: new Date(),
      });
      await this.audit.record(tx, pfAccountId, { action, entity: "pf_account", entityId: pfAccountId, detail: deviceLabel ? { deviceLabel } : null });
      return { accessToken, refreshToken };
    });
  }
}
