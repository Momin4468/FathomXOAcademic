import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { schema } from "@business-os/db";
import {
  REFRESH_TOKEN_TTL_DAYS,
  type RlsContext,
  type SessionPrincipal,
} from "@business-os/shared";
import { and, eq, isNull } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { PermissionService } from "../authz/permission.service.js";
import { EncryptionService } from "../crypto/encryption.service.js";
import { DbService } from "../db/db.service.js";
import { SlidingWindowRateLimiter } from "../ratelimit/sliding-window.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { TotpService } from "./totp.service.js";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function slidingExpiry(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Auth orchestration. Identity is established here and only here; the rest of the
 * app trusts the signed tokens this issues. See /docs/DECISIONS.md (Module 0).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Brute-force protection on login (CLAUDE.md §4 "rate-limit auth"). Best-effort,
  // in-process — same SlidingWindowRateLimiter used by password-reset / public intake.
  // Primary: per (IP + email) — throttles targeted guessing on one account without
  // blocking a shared office IP from logging into different accounts. Secondary: per
  // IP — catches credential stuffing across many emails from one source. Checked
  // BEFORE any lookup/verify, and the 429 is generic (no account enumeration).
  private readonly loginIpEmailLimiter = new SlidingWindowRateLimiter(
    Number(process.env.AUTH_LOGIN_RATE_MAX ?? 10),
    Number(process.env.AUTH_LOGIN_RATE_WINDOW_MS ?? 15 * 60 * 1000),
  );
  private readonly loginIpLimiter = new SlidingWindowRateLimiter(
    Number(process.env.AUTH_LOGIN_IP_RATE_MAX ?? 50),
    Number(process.env.AUTH_LOGIN_RATE_WINDOW_MS ?? 15 * 60 * 1000),
  );

  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly crypto: EncryptionService,
  ) {}

  async login(
    email: string,
    password: string,
    totp?: string,
    deviceLabel?: string,
    ip: string = "unknown",
  ): Promise<TokenPair> {
    // Rate-limit BEFORE any lookup/verify. Consume the per-(IP+email) slot first,
    // then the broader per-IP slot (|| short-circuits, mirroring password-reset).
    if (
      !this.loginIpEmailLimiter.allow(`${ip}:${email.trim().toLowerCase()}`) ||
      !this.loginIpLimiter.allow(ip)
    ) {
      throw new HttpException("Too many login attempts — please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const row = await this.db.authLookup(email);
    // Unknown email: no org to scope an audit row → app-log only, generic 401.
    if (!row) {
      this.logger.warn(`Login failed: unknown email`);
      throw new UnauthorizedException("Invalid credentials");
    }

    const baseCtx: RlsContext = { orgId: row.org_id, partyId: row.party_id, isSuperadmin: false };
    const fail = async (reason: string): Promise<never> => {
      await this.audit.recordScoped(baseCtx, {
        actorUserId: row.id,
        action: "auth.login_failed",
        entity: "user_account",
        entityId: row.id,
        detail: { reason },
      });
      throw new UnauthorizedException("Invalid credentials");
    };

    if (row.status !== "active") return fail(`status:${row.status}`);
    if (!(await this.passwords.verify(password, row.password_hash))) return fail("password");
    if (row.twofa_secret) {
      // The stored secret is sealed (enc:) or a legacy plaintext; open before verify.
      // A corrupt/undecryptable secret (or missing key for a sealed value) fails
      // closed as an auth failure — never a 500.
      let plaintext: string;
      let legacy: boolean;
      try {
        ({ plaintext, legacy } = this.crypto.open(row.twofa_secret));
      } catch {
        return fail("totp_unreadable");
      }
      if (!totp || !this.totp.verify(totp, plaintext)) return fail("totp");
      // Lazy migration: re-seal a legacy plaintext secret on this success (best-effort).
      if (legacy) {
        try {
          await this.db.withTenant(baseCtx, (tx) =>
            tx
              .update(schema.userAccount)
              .set({ twofaSecret: this.crypto.seal(plaintext) })
              .where(eq(schema.userAccount.id, row.id)),
          );
        } catch {
          /* non-fatal: a failed re-seal must never block a valid login */
        }
      }
    }

    // Issue tokens + persist the refresh row + audit, all in one tenant tx.
    return this.db.withTenant(baseCtx, async (tx) => {
      const eff = await this.permissions.loadEffective(tx, row.id);
      const principal: SessionPrincipal = {
        userId: row.id,
        orgId: row.org_id,
        partyId: row.party_id,
        isSystemSuperadmin: this.permissions.isSystemSuperadmin(eff.roleNames),
      };
      const accessToken = this.tokens.signAccess(principal);
      const { token: refreshToken } = this.tokens.signRefresh(principal);
      await tx.insert(schema.authRefreshToken).values({
        orgId: row.org_id,
        userId: row.id,
        tokenHash: this.tokens.hashToken(refreshToken),
        deviceLabel: deviceLabel ?? null,
        expiresAt: slidingExpiry(),
        lastUsedAt: new Date(),
      });
      await this.audit.record(tx, row.org_id, {
        actorUserId: row.id,
        action: "auth.login",
        entity: "user_account",
        entityId: row.id,
        detail: deviceLabel ? { deviceLabel } : null,
      });
      return { accessToken, refreshToken };
    });
  }

  /** Rotate: revoke the presented refresh token, issue a new pair, slide expiry. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const claims = this.tokens.verifyRefresh(refreshToken);
    const ctx: RlsContext = {
      orgId: claims.orgId,
      partyId: claims.partyId,
      isSuperadmin: false,
    };
    const presentedHash = this.tokens.hashToken(refreshToken);

    // CRITICAL: the reuse-detection family-revoke + audit MUST commit even though
    // the request is rejected — so the callback NEVER throws (withTenant rolls back
    // on throw, which would undo the revocation and leave reuse-detection inert).
    // It returns an outcome that always commits; the 401 is thrown OUTSIDE the tx.
    const outcome = await this.db.withTenant(ctx, async (tx): Promise<TokenPair | null> => {
      // Look up by hash regardless of state so we can DETECT reuse of an
      // already-rotated/revoked token (a theft signal).
      const [row] = await tx
        .select()
        .from(schema.authRefreshToken)
        .where(
          and(
            eq(schema.authRefreshToken.tokenHash, presentedHash),
            eq(schema.authRefreshToken.userId, claims.sub),
          ),
        );
      if (!row) return null;

      // Reuse of a revoked token → kill the whole family (defensive) and audit
      // (and COMMIT it — we return null, never throw).
      if (row.revokedAt) {
        await tx
          .update(schema.authRefreshToken)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.authRefreshToken.userId, claims.sub),
              isNull(schema.authRefreshToken.revokedAt),
            ),
          );
        await this.audit.record(tx, row.orgId, {
          actorUserId: claims.sub,
          action: "auth.refresh_reuse_detected",
          entity: "auth_refresh_token",
          entityId: row.id,
        });
        return null;
      }
      if (row.expiresAt.getTime() <= Date.now()) {
        return null;
      }

      // Atomic conditional revoke — if another concurrent refresh already flipped
      // it, we lose the race and reject (prevents double-spend of one token).
      const revoked = await tx
        .update(schema.authRefreshToken)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.authRefreshToken.id, row.id),
            isNull(schema.authRefreshToken.revokedAt),
          ),
        )
        .returning({ id: schema.authRefreshToken.id });
      if (revoked.length === 0) {
        return null;
      }

      // Re-derive roles (they may have changed since the token was minted).
      const eff = await this.permissions.loadEffective(tx, claims.sub);
      const principal: SessionPrincipal = {
        userId: claims.sub,
        orgId: claims.orgId,
        partyId: claims.partyId,
        isSystemSuperadmin: this.permissions.isSystemSuperadmin(eff.roleNames),
      };
      const accessToken = this.tokens.signAccess(principal);
      const { token: newRefresh } = this.tokens.signRefresh(principal);
      await tx.insert(schema.authRefreshToken).values({
        orgId: claims.orgId,
        userId: claims.sub,
        tokenHash: this.tokens.hashToken(newRefresh),
        deviceLabel: row.deviceLabel,
        expiresAt: slidingExpiry(),
        lastUsedAt: new Date(),
      });
      await this.audit.record(tx, row.orgId, {
        actorUserId: claims.sub,
        action: "auth.token_refreshed",
        entity: "auth_refresh_token",
        entityId: row.id,
      });
      return { accessToken, refreshToken: newRefresh };
    });
    if (!outcome) throw new UnauthorizedException("Invalid or expired refresh token");
    return outcome;
  }

  /** Server-side revocation: the device's refresh token can no longer mint tokens. */
  async logout(refreshToken: string): Promise<void> {
    const claims = this.tokens.verifyRefresh(refreshToken);
    const ctx: RlsContext = {
      orgId: claims.orgId,
      partyId: claims.partyId,
      isSuperadmin: false,
    };
    const presentedHash = this.tokens.hashToken(refreshToken);
    await this.db.withTenant(ctx, async (tx) => {
      const res = await tx
        .update(schema.authRefreshToken)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.authRefreshToken.tokenHash, presentedHash),
            isNull(schema.authRefreshToken.revokedAt),
          ),
        )
        .returning({ id: schema.authRefreshToken.id });
      await this.audit.record(tx, claims.orgId, {
        actorUserId: claims.sub,
        action: "auth.logout",
        entity: "auth_refresh_token",
        entityId: res[0]?.id ?? null,
      });
    });
  }

  /** Start 2FA enrollment — returns a secret + otpauth URL to show as a QR. */
  async enroll2fa(
    principal: SessionPrincipal,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const ctx: RlsContext = {
      orgId: principal.orgId,
      partyId: principal.partyId,
      isSuperadmin: false,
    };
    const email = await this.db.withTenant(ctx, async (tx) => {
      const [u] = await tx
        .select({ email: schema.userAccount.email })
        .from(schema.userAccount)
        .where(eq(schema.userAccount.id, principal.userId));
      return u?.email ?? principal.userId;
    });
    const secret = this.totp.generateSecret();
    return { secret, otpauthUrl: this.totp.keyUri(email, secret) };
  }

  /** Confirm enrollment by verifying a code against the secret, then persist it. */
  async enable2fa(principal: SessionPrincipal, secret: string, code: string): Promise<void> {
    if (!this.totp.verify(code, secret)) {
      throw new BadRequestException("Invalid 2FA code");
    }
    const ctx: RlsContext = {
      orgId: principal.orgId,
      partyId: principal.partyId,
      isSuperadmin: false,
    };
    await this.db.withTenant(ctx, async (tx) => {
      await tx
        .update(schema.userAccount)
        .set({ twofaSecret: this.crypto.seal(secret), updatedAt: new Date() })
        .where(eq(schema.userAccount.id, principal.userId));
      await this.audit.record(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "auth.2fa_enabled",
        entity: "user_account",
        entityId: principal.userId,
      });
    });
  }
}
