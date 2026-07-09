import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../../common/auth/auth.module.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { PfAuthController } from "./auth/pf-auth.controller.js";
import { PfAuthGuard } from "./auth/pf-auth.guard.js";
import { PfAuthService } from "./auth/pf-auth.service.js";
import { PfTokenService } from "./auth/pf-token.service.js";
import { PfCategoryController } from "./categories/pf-category.controller.js";
import { PfCategoryService } from "./categories/pf-category.service.js";
import { PfDashboardController } from "./dashboard/pf-dashboard.controller.js";
import { PfDashboardService } from "./dashboard/pf-dashboard.service.js";
import { PfEntryController } from "./entries/pf-entry.controller.js";
import { PfEntryService } from "./entries/pf-entry.service.js";
import { PfLinkController } from "./link/pf-link.controller.js";
import { PfLinkService } from "./link/pf-link.service.js";
import { PfLoanController } from "./loans/pf-loan.controller.js";
import { PfLoanService } from "./loans/pf-loan.service.js";
import { PfAuditService } from "./pf-audit.service.js";
import { PfSavingController } from "./savings/pf-saving.controller.js";
import { PfSavingService } from "./savings/pf-saving.service.js";
import { PfInvestmentController } from "./investments/pf-investment.controller.js";
import { PfInvestmentService } from "./investments/pf-investment.service.js";
import { PfCashController } from "./cash/pf-cash.controller.js";
import { PfCashService } from "./cash/pf-cash.service.js";
import { PfSubscriptionController } from "./subscriptions/pf-subscription.controller.js";
import { PfReminderService } from "./subscriptions/pf-reminder.service.js";
import { PfSubscriptionService } from "./subscriptions/pf-subscription.service.js";
import { PfTargetController } from "./targets/pf-target.controller.js";
import { PfTargetService } from "./targets/pf-target.service.js";
import { PfAttachmentController, PfNoteController } from "./notes/pf-note.controller.js";
import { PfNoteService } from "./notes/pf-note.service.js";
import { PfNoteReminderService } from "./notes/pf-note-reminder.service.js";
import { PfPreferencesController } from "./preferences/pf-preferences.controller.js";
import { PfPreferencesService } from "./preferences/pf-preferences.service.js";
import { PfInsightsController } from "./insights/pf-insights.controller.js";
import { PfInsightsService } from "./insights/pf-insights.service.js";
import { PfAnomalyController } from "./anomaly/pf-anomaly.controller.js";
import { PfAnomalyService } from "./anomaly/pf-anomaly.service.js";
import { PfAnomalyReminderService } from "./anomaly/pf-anomaly-reminder.service.js";
import { PfAiQuickAddController } from "./ai/pf-ai-quickadd.controller.js";
import { PfAiQuickAddService } from "./ai/pf-ai-quickadd.service.js";
import { AI_CAPTURE_PROVIDER } from "../ai-capture/provider/ai-capture.port.js";
import { DevCaptureProvider } from "../ai-capture/provider/dev.provider.js";
import { GeminiCaptureProvider } from "../ai-capture/provider/gemini.provider.js";
import { ClaudeCaptureProvider } from "../ai-capture/provider/claude.provider.js";

/**
 * Module 14 — the PERSONAL FINANCE plane (§11). A SEPARATE, sellable service: its
 * own auth (PfTokenService/PfAuthGuard), its own RLS tenancy (pf_account), joined
 * to the business only by the one-way income bridge. Gated `personal_finance`.
 *
 * Reuses PasswordService/TotpService (from AuthModule), EncryptionService +
 * EmailService + DbService (global) — no second auth/email pipeline. Registers its
 * own JwtModule (same secret) so PF tokens are signed/verified with distinct typ.
 */
@Module({
  imports: [
    AuthModule, // PasswordService, TotpService
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32) {
          throw new Error("JWT_SECRET must be set and at least 32 characters");
        }
        return {
          secret,
          signOptions: { algorithm: "HS256" },
          verifyOptions: { algorithms: ["HS256"] },
        };
      },
    }),
  ],
  controllers: [
    PfAuthController,
    PfLinkController,
    PfCategoryController,
    PfEntryController,
    PfLoanController,
    PfSavingController,
    PfInvestmentController,
    PfCashController,
    PfTargetController,
    PfSubscriptionController,
    PfDashboardController,
    PfNoteController,
    PfAttachmentController,
    PfPreferencesController,
    PfInsightsController,
    PfAnomalyController,
    PfAiQuickAddController,
  ],
  providers: [
    StorageService,
    PfTokenService,
    PfAuthGuard,
    PfAuditService,
    PfAuthService,
    PfLinkService,
    PfCategoryService,
    PfEntryService,
    PfLoanService,
    PfSavingService,
    PfInvestmentService,
    PfCashService,
    PfTargetService,
    PfSubscriptionService,
    PfReminderService,
    PfDashboardService,
    PfNoteService,
    PfNoteReminderService,
    PfPreferencesService,
    PfInsightsService,
    PfAnomalyService,
    PfAnomalyReminderService,
    PfAiQuickAddService,
    // Reuse the SAME swappable extraction provider as the business AI capture
    // (dev|gemini|claude) — no second pipeline. PF quick-add keeps all persistence
    // + the daily cap in the PF plane (pf_ai_usage), never the business tables.
    {
      provide: AI_CAPTURE_PROVIDER,
      useFactory: () => {
        const which = (process.env.AI_CAPTURE_PROVIDER ?? "dev").toLowerCase();
        if (which === "gemini") return new GeminiCaptureProvider();
        if (which === "claude") return new ClaudeCaptureProvider();
        return new DevCaptureProvider();
      },
    },
  ],
})
export class PersonalFinanceModule {}
