import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { DbService, type ResetPlane } from "../db/db.service.js";
import { EmailService } from "../email/email.service.js";
import { SlidingWindowRateLimiter } from "../ratelimit/sliding-window.js";
import { PasswordService } from "./password.service.js";

/** Where each plane's reset page lives in the web app (link target in the email). */
const PLANE_PATH: Record<ResetPlane, string> = {
  business: "/reset-password",
  pf: "/personal-finance/reset-password",
  client: "/portal/reset-password",
};

/** Human label per plane for the email copy. */
const PLANE_LABEL: Record<ResetPlane, string> = {
  business: "Business OS",
  pf: "Personal Finance",
  client: "Client Portal",
};

/**
 * Self-service password reset, shared by all three auth planes (CLAUDE.md §4
 * security baseline). The flow is deliberately uniform and NON-ENUMERATING:
 *
 *  request(plane, identifier) — rate-limited (per-IP AND per-identifier); resolves
 *    the account via the plane's pre-auth lookup; if (and only if) it exists and is
 *    eligible, mints a single-use, expiring, sha256-HASHED token (the raw token
 *    lives only in the emailed link) and sends the reset link. ALWAYS returns the
 *    same generic {ok} — the response never reveals whether the account exists.
 *
 *  reset(plane, token, newPassword) — rate-limited (per-IP); hashes the new password
 *    (bcrypt) and hands it to the plane's consume definer, which atomically spends
 *    the token, sets password_hash, and REVOKES ALL the account's live refresh tokens
 *    (a reset kills every session). A bad/expired/used token yields one generic 400.
 *
 * The token table is definer-only (no RLS policy / no app_user grant) so the whole
 * flow works PRE-AUTH with no session/RLS context — see migration 0034.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly webBaseUrl = (process.env.WEB_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  private readonly ttlMin = Number(process.env.PASSWORD_RESET_TTL_MIN ?? 60);
  // Best-effort, in-process abuse protection (mirror the public intake): cap reset
  // requests per IP and per identifier, and reset attempts per IP.
  private readonly requestIpLimiter = new SlidingWindowRateLimiter(
    Number(process.env.PASSWORD_RESET_RATE_MAX ?? 5),
    Number(process.env.PASSWORD_RESET_RATE_WINDOW_MS ?? 15 * 60 * 1000),
  );
  private readonly requestIdLimiter = new SlidingWindowRateLimiter(
    Number(process.env.PASSWORD_RESET_RATE_MAX ?? 5),
    Number(process.env.PASSWORD_RESET_RATE_WINDOW_MS ?? 15 * 60 * 1000),
  );
  private readonly resetIpLimiter = new SlidingWindowRateLimiter(
    Number(process.env.PASSWORD_RESET_CONSUME_MAX ?? 20),
    Number(process.env.PASSWORD_RESET_RATE_WINDOW_MS ?? 15 * 60 * 1000),
  );

  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly email: EmailService,
  ) {}

  /**
   * Step 1 — request a reset link. Generic by design: returns the same {ok}
   * whether or not the identifier matches an account. The existence-dependent work
   * (lookup → mint → email) runs OFF the response path so response latency can't
   * reveal whether the account exists (no timing oracle, not just an identical
   * body). Throws 429 only when the caller is rate-limited (independent of account
   * existence). Errors are logged, never surfaced.
   */
  async request(plane: ResetPlane, identifier: string, ip: string): Promise<{ ok: true }> {
    const id = identifier.trim().toLowerCase();
    if (!this.requestIpLimiter.allow(`${plane}:${ip}`) || !this.requestIdLimiter.allow(`${plane}:${id}`)) {
      throw new HttpException("Too many requests — please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
    // Fire-and-forget: never await the resolve/mint/send, so an existing account
    // (which does a DB write + an email send) isn't observably slower than an
    // unknown one (which does nothing). The response returns immediately either way.
    void this.dispatch(plane, id).catch((err) => {
      this.logger.error(`password reset dispatch failed (${plane}): ${(err as Error).message}`);
    });
    return { ok: true };
  }

  /** The existence-dependent half of request(), run off the response path. */
  private async dispatch(plane: ResetPlane, id: string): Promise<void> {
    const resolved = await this.resolve(plane, id);
    if (!resolved) return;
    const rawToken = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlMin * 60 * 1000);
    await this.db.pwResetRequest(plane, resolved.accountId, this.hashToken(rawToken), expiresAt);
    const link = `${this.webBaseUrl}${PLANE_PATH[plane]}?token=${rawToken}`;
    await this.email.send({
      to: resolved.email,
      subject: `Reset your ${PLANE_LABEL[plane]} password`,
      text:
        `We received a request to reset your ${PLANE_LABEL[plane]} password.\n\n` +
        `Open this link to choose a new password (it expires in ${this.ttlMin} minutes and can be used once):\n` +
        `${link}\n\n` +
        `If you didn't request this, you can safely ignore this email — your password won't change.`,
    });
  }

  /**
   * Step 2 — set a new password using the emailed token. The consume definer is
   * atomic (spend token + set password + revoke all sessions + audit). A null result
   * (invalid / expired / already-used) maps to one generic error — no distinction
   * that could be probed.
   */
  async reset(plane: ResetPlane, token: string, newPassword: string, ip: string): Promise<{ ok: true }> {
    if (!this.resetIpLimiter.allow(`${plane}:${ip}`)) {
      throw new HttpException("Too many requests — please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const newHash = await this.passwords.hash(newPassword);
    const accountId = await this.db.pwResetConsume(plane, this.hashToken(token), newHash);
    if (!accountId) {
      throw new BadRequestException("This reset link is invalid or has expired. Please request a new one.");
    }
    return { ok: true };
  }

  /** Resolve an identifier to an eligible account + the address to email, or null. */
  private async resolve(
    plane: ResetPlane,
    identifier: string,
  ): Promise<{ accountId: string; email: string } | null> {
    if (plane === "business") {
      const row = await this.db.authLookup(identifier);
      if (!row || row.status !== "active") return null;
      return { accountId: row.id, email: identifier };
    }
    if (plane === "pf") {
      const row = await this.db.pfAuthLookup(identifier);
      if (!row || row.status !== "active") return null;
      return { accountId: row.id, email: identifier };
    }
    // client — login_id may be a student/client id, so use the resolved contact email.
    const row = await this.db.clientResetLookup(identifier);
    if (!row || !row.email) return null;
    // Don't mint a token we can't deliver: the lookup falls back to login_id when the
    // party has no contact email, and a login_id may be a non-address student id.
    if (!row.email.includes("@")) return null;
    // Same eligibility as client login: active/invited/lead, but not an expired lead.
    if (row.status !== "active" && row.status !== "invited" && row.status !== "lead") return null;
    if (row.status === "lead" && row.expires_at && row.expires_at.getTime() < Date.now()) return null;
    return { accountId: row.id, email: row.email };
  }

  /** sha256 of the raw token — only the hash is ever stored (matches the definers). */
  private hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }
}
