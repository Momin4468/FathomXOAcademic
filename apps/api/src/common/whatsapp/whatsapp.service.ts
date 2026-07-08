import { Injectable, Logger } from "@nestjs/common";

export interface WhatsAppMessage {
  to: string; // E.164 phone (a real provider validates; the dev adapter just logs it)
  text: string;
}

/**
 * Swappable WhatsApp sender (mirrors EmailService). The adapter is chosen by
 * WHATSAPP_ADAPTER: `dev` (default) is a NO-OP that logs the envelope only
 * (to/length, NEVER the body — messages may carry client detail); a real provider
 * (Meta Cloud API, Twilio, …) drops in later as another branch, no call-site
 * change. Deferred by design (P1 item 8): the intake path already calls this so
 * wiring a provider is env-only. Global (WhatsAppModule) so any module can reuse it.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly adapter = (process.env.WHATSAPP_ADAPTER ?? "dev").toLowerCase();

  async send(msg: WhatsAppMessage): Promise<void> {
    if (this.adapter === "dev") {
      // Envelope only — never the body (no client detail leaked into logs).
      this.logger.log(`[whatsapp:dev] to=${msg.to} len=${msg.text.length} (no-op)`);
      return;
    }
    // No real provider is wired yet — fail loudly so a misconfig is obvious rather
    // than silently dropping a client message.
    throw new Error(
      `WHATSAPP_ADAPTER='${this.adapter}' has no adapter — set WHATSAPP_ADAPTER=dev (a real provider is a future drop-in)`,
    );
  }
}
