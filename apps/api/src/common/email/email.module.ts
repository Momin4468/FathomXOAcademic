import { Global, Module } from "@nestjs/common";
import { EmailService } from "./email.service.js";

/**
 * Global, swappable email sender (CLAUDE.md §2: boring, mainstream, swappable).
 * Provided once and exported everywhere — subscription reminders now, Phase-3
 * personal-finance reminders later. Dev adapter by default (no real send).
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
