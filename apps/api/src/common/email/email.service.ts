import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Swappable email sender (mirrors StorageService). The adapter is chosen by
 * EMAIL_ADAPTER: `dev` (default) logs the envelope (to/subject, NEVER the body —
 * bodies may carry sensitive detail) and, if EMAIL_OUTBOX_DIR is set, writes the
 * full message there for inspection/tests. A real SMTP/API provider is a later
 * env-driven swap (same pattern as StorageService → S3). Global (EmailModule) so
 * the business reminders now and Phase-3 personal finance later both reuse it.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly adapter = (process.env.EMAIL_ADAPTER ?? "dev").toLowerCase();
  private readonly from = process.env.EMAIL_FROM ?? "no-reply@fathomxo.local";
  private readonly outboxDir: string | null;
  private ready: Promise<void> = Promise.resolve();

  constructor() {
    const dir = process.env.EMAIL_OUTBOX_DIR;
    this.outboxDir = dir ? (isAbsolute(dir) ? dir : resolve(process.cwd(), dir)) : null;
    if (this.outboxDir) this.ready = mkdir(this.outboxDir, { recursive: true }).then(() => undefined);
  }

  async send(msg: EmailMessage): Promise<void> {
    if (this.adapter === "dev") {
      // Envelope only — never the body (no secret leak into logs).
      this.logger.log(`[email:dev] from=${this.from} to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
      if (this.outboxDir) {
        await this.ready;
        await writeFile(
          resolve(this.outboxDir, `${Date.now()}-${randomUUID()}.json`),
          JSON.stringify({ from: this.from, ...msg }, null, 2),
          "utf8",
        );
      }
      return;
    }
    // Real provider not wired yet — fail loudly so a misconfig is obvious.
    throw new Error(
      `EMAIL_ADAPTER='${this.adapter}' has no adapter — set EMAIL_ADAPTER=dev or implement the provider`,
    );
  }
}
