import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { and, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { PasswordService } from "../../common/auth/password.service.js";
import { DbService } from "../../common/db/db.service.js";
import { EmailService } from "../../common/email/email.service.js";
import { SlidingWindowRateLimiter } from "../../common/ratelimit/sliding-window.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { FILES_MAX_BYTES, type UploadedFile } from "../files/files.service.js";
import type { PublicQuoteDto } from "./public-intake.dto.js";

const SEED_ORG = "00000000-0000-4000-8000-000000000001";
/** Cloudflare Turnstile server-side verification endpoint. */
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Brief allowlist (the file rule): Word / PDF / TXT / images ONLY. */
const ALLOWED_EXT = new Set([".pdf", ".txt", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * The PUBLIC, unauthenticated quote intake — the marketing site's lead funnel.
 * It threads into the EXISTING client-portal lead lifecycle (module 18): a
 * submission becomes a provisional client party + a `lead` client_account (so the
 * promote-on-confirm trigger + retention purge apply) + a DRAFT work_item (source
 * forced, ZERO legs, NEVER priced). The admin prices it later = the quote. No
 * internal/price/writer data is ever returned. Abuse-guarded by a honeypot + a
 * best-effort per-IP rate limit + a strict file allowlist.
 */
@Injectable()
export class PublicIntakeService {
  private readonly logger = new Logger(PublicIntakeService.name);
  private readonly orgId = process.env.PUBLIC_LEAD_ORG_ID ?? SEED_ORG;
  // Cloudflare Turnstile secret. Unset (dev/test) → verification is skipped entirely,
  // mirroring how AI_CAPTURE_PROVIDER=dev degrades gracefully rather than failing closed.
  private readonly turnstileSecret = process.env.TURNSTILE_SECRET_KEY?.trim() || null;
  private readonly leadTtlDays = Number(process.env.CLIENT_LEAD_TTL_DAYS ?? 30);
  private readonly opsInbox = process.env.PUBLIC_QUOTE_NOTIFY_EMAIL ?? null;
  private readonly ipLimiter = new SlidingWindowRateLimiter(
    Number(process.env.PUBLIC_QUOTE_RATE_MAX ?? 5),
    Number(process.env.PUBLIC_QUOTE_RATE_WINDOW_MS ?? 60 * 60 * 1000),
  );
  private readonly globalLimiter = new SlidingWindowRateLimiter(
    Number(process.env.PUBLIC_QUOTE_GLOBAL_MAX ?? 500),
    60 * 60 * 1000,
  );
  // Per-recipient cap so the acknowledgement email can't be abused as an
  // unauthenticated "email anyone" primitive once a real SMTP provider is wired.
  private readonly emailLimiter = new SlidingWindowRateLimiter(2, 24 * 60 * 60 * 1000);

  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async submitQuote(dto: PublicQuoteDto, file: UploadedFile | undefined, clientIp: string): Promise<{ ok: true }> {
    // Bot gate FIRST — before rate-limiting or any write. The API is authoritative
    // for public-intake checks (the marketing BFF only does best-effort/UX work).
    await this.verifyTurnstile(dto.turnstileToken, clientIp);

    // Rate-limit (before the honeypot short-circuit) so a bot that fills
    // the honeypot is still bounded and can't hammer the endpoint for free.
    if (!this.globalLimiter.allow("global") || !this.ipLimiter.allow(clientIp || "unknown")) {
      throw new HttpException("Too many requests — please try again in a little while.", HttpStatus.TOO_MANY_REQUESTS);
    }

    // Honeypot — a filled hidden field is a bot. Silently succeed, write nothing.
    if (dto.website && dto.website.trim()) return { ok: true };

    // Validate the brief BEFORE any write (strict allowlist; reject video/other).
    if (file) this.assertAllowedBrief(file);

    await this.db.withTenant({ orgId: this.orgId, partyId: null, isSuperadmin: false }, async (tx) => {
      const email = dto.email.trim();
      const [existing] = await tx
        .select({ id: schema.clientAccount.id, partyId: schema.clientAccount.partyId, status: schema.clientAccount.status })
        .from(schema.clientAccount)
        .where(eq(schema.clientAccount.loginId, email));

      let partyId: string;
      let accountId: string | null;
      if (existing && existing.status === "lead") {
        // A repeat LEAD submitter — attach a new draft to their existing lead
        // party/account (never modify it). Only leads are reused: an active/invited
        // client is NOT attached to (no planting a draft/brief into a real client's
        // portal); a fresh provisional party is created instead and an admin triages.
        partyId = existing.partyId;
        accountId = existing.id;
      } else {
        const [party] = await tx
          .insert(schema.party)
          .values({
            orgId: this.orgId,
            displayName: dto.name.trim(),
            partyType: ["client"],
            contactJson: {
              email,
              phone: dto.phone?.trim() || null,
              country: dto.country?.trim() || null,
            },
            createdBy: null,
            updatedBy: null,
          })
          .returning({ id: schema.party.id });
        partyId = party!.id;
        if (existing) {
          // The email already belongs to a NON-lead account (a real client). The
          // login_id is unique, so we can't mint a second account — leave this draft
          // unlinked (no lead account) for an admin to triage/merge. Rare collision.
          accountId = null;
        } else {
          // A `lead` account with an UNUSABLE random password (NOT NULL) — it can't
          // be logged into until an admin sets a real password; expires_at makes it
          // purge-able if the lead never converts.
          const passwordHash = await this.passwords.hash(`${randomUUID()}${randomUUID()}`);
          const expiresAt = new Date(Date.now() + this.leadTtlDays * 24 * 60 * 60 * 1000);
          const [acct] = await tx
            .insert(schema.clientAccount)
            .values({
              orgId: this.orgId,
              partyId,
              loginId: email,
              passwordHash,
              status: "lead",
              expiresAt,
              createdBy: null,
              updatedBy: null,
            })
            .returning({ id: schema.clientAccount.id });
          accountId = acct!.id;
        }
      }

      // The DRAFT work_item — source FORCED to the lead's party, zero legs, never
      // priced. `client_account_id` powers the admin queue + the promote trigger.
      const detailLines = [
        dto.service ? `Service: ${dto.service.trim()}` : null,
        dto.level ? `Level: ${dto.level.trim()}` : null,
        dto.deadline ? `Deadline: ${dto.deadline.trim()}` : null,
        dto.wordCount ? `Words: ${dto.wordCount.trim()}` : null,
        dto.country ? `Country: ${dto.country.trim()}` : null,
        dto.phone ? `WhatsApp/phone: ${dto.phone.trim()}` : null,
        "",
        dto.details.trim(),
      ].filter((l) => l !== null);
      const title = (dto.service?.trim() || "Quote request").slice(0, 280);
      const [item] = await tx
        .insert(schema.workItem)
        .values({
          orgId: this.orgId,
          title,
          details: detailLines.join("\n"),
          sourcePartyId: partyId,
          clientAccountId: accountId,
          // work_state defaults 'draft', money_state 'unbilled' — never priced.
          updatedAt: new Date(),
        })
        .returning({ id: schema.workItem.id });
      const workItemId = item!.id;

      // Optional brief — stored via the file pipeline, kind 'brief' (ACL-scoped to
      // the source party + work:approve). createdBy null (no authenticated user).
      if (file) {
        const key = await this.storage.put(file.buffer);
        const [fileObj] = await tx
          .insert(schema.fileObject)
          .values({
            orgId: this.orgId,
            kind: "brief",
            isLink: false,
            url: key,
            filename: file.originalname,
            sizeBytes: file.size,
            mime: file.mimetype,
            createdBy: null,
          })
          .returning({ id: schema.fileObject.id });
        await tx
          .update(schema.workItem)
          .set({ briefFileId: fileObj!.id, updatedAt: new Date() })
          .where(eq(schema.workItem.id, workItemId));
      }

      await this.audit.record(tx, this.orgId, {
        actorUserId: null,
        action: "public.quote_submitted",
        entity: "work_item",
        entityId: workItemId,
        detail: { clientAccountId: accountId, hasBrief: !!file, repeat: !!existing },
      });
    });

    // Best-effort notifications (dev adapter logs envelope only). Never block.
    void this.notify(dto).catch((e) => this.logger.warn(`quote notify failed: ${(e as Error).message}`));
    return { ok: true };
  }

  /**
   * Verify a Cloudflare Turnstile token server-side. No secret configured → skip
   * (dev parity). Otherwise a missing token is rejected without a network call, and
   * a present token is checked against Cloudflare's siteverify. Any non-success (bad
   * token, transport error, timeout) fails CLOSED with a GENERIC 400 — Cloudflare's
   * internal error codes are logged for ops but NEVER leaked to the client.
   */
  private async verifyTurnstile(token: string | undefined, clientIp: string): Promise<void> {
    if (!this.turnstileSecret) return; // optional-in-dev: unconfigured → no gate
    const generic = "Verification failed — please complete the challenge and try again.";
    const tok = token?.trim();
    if (!tok) throw new BadRequestException(generic);

    let ok = false;
    try {
      const body = new URLSearchParams({ secret: this.turnstileSecret, response: tok });
      if (clientIp && clientIp !== "unknown") body.set("remoteip", clientIp);
      const resp = await fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const data = (await resp.json()) as { success?: boolean; "error-codes"?: string[] };
      ok = data?.success === true;
      if (!ok) {
        // Log Cloudflare's codes for ops visibility; the client gets only the generic message.
        this.logger.warn(`Turnstile verification rejected: ${JSON.stringify(data?.["error-codes"] ?? [])}`);
      }
    } catch (e) {
      // Fail closed on any transport/parse error when a secret IS configured.
      this.logger.warn(`Turnstile verification error: ${(e as Error).message}`);
      ok = false;
    }
    if (!ok) throw new BadRequestException(generic);
  }

  /** Strict brief allowlist — Word / PDF / TXT / image only; reject all else. */
  private assertAllowedBrief(file: UploadedFile): void {
    if (file.size > FILES_MAX_BYTES) {
      throw new BadRequestException(`File too large (max ${Math.floor(FILES_MAX_BYTES / 1024 / 1024)}MB).`);
    }
    const mime = (file.mimetype || "").toLowerCase();
    if (mime.startsWith("video/")) {
      throw new BadRequestException("Video files aren't accepted — please share a document, PDF, or image.");
    }
    const ext = extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      throw new BadRequestException("Unsupported file type — attach a Word, PDF, TXT, or image file.");
    }
    // Cross-check the declared MIME against the extension allowlist (a browser may
    // send application/octet-stream for .doc/.docx — tolerated). Reject a clearly
    // mismatched content-type (e.g. an executable masquerading as .pdf).
    const okMime = !mime || mime === "application/octet-stream" || mime.startsWith("image/") || ALLOWED_MIME.has(mime);
    if (!okMime) {
      throw new BadRequestException("That file's content type doesn't match its name — please re-attach.");
    }
  }

  private async notify(dto: PublicQuoteDto): Promise<void> {
    const subject = `New quote request: ${dto.service?.trim() || "general"}`;
    if (this.opsInbox) {
      await this.email.send({ to: this.opsInbox, subject, text: `A new quote request was submitted by ${dto.name} <${dto.email}>.` });
    }
    // Acknowledge the prospective client — capped per recipient so this can't be
    // abused as an unauthenticated "email anyone" primitive once SMTP is wired.
    const email = dto.email.trim();
    if (this.emailLimiter.allow(email.toLowerCase())) {
      await this.email.send({
        to: email,
        subject: "We've received your request — X-Factor Academic Solutions",
        text: "Thanks for your request. Our team will review it and get back to you with a quote shortly, on WhatsApp or email.",
      });
    }
  }
}
