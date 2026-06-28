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
import { PfSubscriptionController } from "./subscriptions/pf-subscription.controller.js";
import { PfReminderService } from "./subscriptions/pf-reminder.service.js";
import { PfSubscriptionService } from "./subscriptions/pf-subscription.service.js";
import { PfTargetController } from "./targets/pf-target.controller.js";
import { PfTargetService } from "./targets/pf-target.service.js";
import { PfAttachmentController, PfNoteController } from "./notes/pf-note.controller.js";
import { PfNoteService } from "./notes/pf-note.service.js";
import { PfNoteReminderService } from "./notes/pf-note-reminder.service.js";

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
    PfTargetController,
    PfSubscriptionController,
    PfDashboardController,
    PfNoteController,
    PfAttachmentController,
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
    PfTargetService,
    PfSubscriptionService,
    PfReminderService,
    PfDashboardService,
    PfNoteService,
    PfNoteReminderService,
  ],
})
export class PersonalFinanceModule {}
