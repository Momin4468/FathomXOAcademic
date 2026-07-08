import { Global, Module } from "@nestjs/common";
import { WhatsAppService } from "./whatsapp.service.js";

/**
 * Global, swappable WhatsApp sender (mirrors EmailModule; CLAUDE.md §2: boring,
 * swappable). Dev no-op by default (P1 item 8 defers the real push); a provider
 * drops in via WHATSAPP_ADAPTER with no call-site change.
 */
@Global()
@Module({
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
