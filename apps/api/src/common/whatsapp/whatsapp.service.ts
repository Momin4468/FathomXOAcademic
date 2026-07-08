import { Injectable, Logger } from "@nestjs/common";

export interface WhatsAppMessage {
  to: string; // E.164 phone (a real provider validates; the dev adapter just logs it)
  text: string;
}

/** Meta WhatsApp Cloud API version (graph.facebook.com/v{N}). */
const META_GRAPH_VERSION = "v21.0";

/**
 * Swappable WhatsApp sender (mirrors EmailService). The adapter is chosen by
 * WHATSAPP_ADAPTER: `dev` (default) is a NO-OP that logs the envelope only
 * (to/length, NEVER the body — messages may carry client detail); `meta` sends via
 * the Meta WhatsApp Cloud API. Either way ONLY the envelope is logged. A misconfig
 * fails loudly at boot (like EMAIL_ADAPTER=resend), never silently dropping a
 * message. Global (WhatsAppModule) so any module can reuse it.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly adapter = (process.env.WHATSAPP_ADAPTER ?? "dev").toLowerCase();
  private readonly accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  constructor() {
    if (this.adapter === "meta" && (!this.accessToken || !this.phoneNumberId)) {
      throw new Error("WHATSAPP_ADAPTER=meta requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID");
    }
  }

  async send(msg: WhatsAppMessage): Promise<void> {
    if (this.adapter === "dev") {
      // Envelope only — never the body (no client detail leaked into logs).
      this.logger.log(`[whatsapp:dev] to=${msg.to} len=${msg.text.length} (no-op)`);
      return;
    }

    if (this.adapter === "meta") {
      // Envelope only — never the body.
      this.logger.log(`[whatsapp:meta] to=${msg.to} len=${msg.text.length}`);
      const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${this.phoneNumberId}/messages`;
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: msg.to,
            type: "text",
            text: { body: msg.text },
          }),
        });
      } catch (e) {
        throw new Error(`WhatsApp (meta) send failed: ${(e as Error).message}`);
      }
      if (!resp.ok) {
        // Log the provider status for ops; never echo the body back to callers.
        const detail = await resp.text().catch(() => "");
        this.logger.warn(`WhatsApp (meta) send rejected: ${resp.status} ${detail.slice(0, 500)}`);
        throw new Error(`WhatsApp (meta) send failed with status ${resp.status}`);
      }
      return;
    }

    // Unknown provider — fail loudly so a misconfig is obvious rather than silently
    // dropping a client message.
    throw new Error(
      `WHATSAPP_ADAPTER='${this.adapter}' has no adapter — set WHATSAPP_ADAPTER=dev or meta`,
    );
  }
}
