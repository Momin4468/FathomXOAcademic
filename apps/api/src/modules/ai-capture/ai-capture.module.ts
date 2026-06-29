import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { FilesModule } from "../files/files.module.js";
import { ReferenceModule } from "../refdata/reference.module.js";
import { WorkModule } from "../work/work.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { ExpenseModule } from "../expense/expense.module.js";
import { AiCaptureController } from "./ai-capture.controller.js";
import { CaptureService } from "./capture.service.js";
import { ProposalService } from "./proposal.service.js";
import { AI_CAPTURE_PROVIDER } from "./provider/ai-capture.port.js";
import { DevCaptureProvider } from "./provider/dev.provider.js";
import { GeminiCaptureProvider } from "./provider/gemini.provider.js";
import { ClaudeCaptureProvider } from "./provider/claude.provider.js";

/**
 * Module 15 — AI capture assistant (§10/§2). Imports the four target modules so
 * Accept routes through their existing create services (stamped "added by AI"),
 * and FilesModule for media bytes. The extraction provider is swappable behind
 * AI_CAPTURE_PROVIDER (dev free default | gemini | claude); the human Accept is
 * the only path that creates a domain record. Gated `FEATURE_AI_CAPTURE`.
 */
@Module({
  imports: [AuthModule, FilesModule, ReferenceModule, WorkModule, BillingModule, ExpenseModule],
  controllers: [AiCaptureController],
  providers: [
    CaptureService,
    ProposalService,
    {
      provide: AI_CAPTURE_PROVIDER,
      useFactory: () => {
        const which = (process.env.AI_CAPTURE_PROVIDER ?? "dev").toLowerCase();
        if (which === "gemini") return new GeminiCaptureProvider();
        if (which === "claude") return new ClaudeCaptureProvider();
        return new DevCaptureProvider(); // free, zero-cost default
      },
    },
  ],
})
export class AiCaptureModule {}
