import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AuditModule } from "./common/audit/audit.module.js";
import { AuthModule } from "./common/auth/auth.module.js";
import { CryptoModule } from "./common/crypto/crypto.module.js";
import { EmailModule } from "./common/email/email.module.js";
import { WhatsAppModule } from "./common/whatsapp/whatsapp.module.js";
import { DbModule } from "./common/db/db.module.js";
import { isModuleEnabled } from "./feature-flags.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { ExpenseModule } from "./modules/expense/expense.module.js";
import { OutcomesModule } from "./modules/outcomes/outcomes.module.js";
import { CredentialVaultModule } from "./modules/credential-vault/credential-vault.module.js";
import { FilesModule } from "./modules/files/files.module.js";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module.js";
import { ChecksModule } from "./modules/checks/checks.module.js";
import { ReferrersModule } from "./modules/referrers/referrers.module.js";
import { CustomFieldsModule } from "./modules/custom-fields/custom-fields.module.js";
import { DashboardModule } from "./modules/dashboard/dashboard.module.js";
import { PersonalFinanceModule } from "./modules/personal-finance/personal-finance.module.js";
import { AiCaptureModule } from "./modules/ai-capture/ai-capture.module.js";
import { ImportExportModule } from "./modules/import-export/import-export.module.js";
import { ChannelsModule } from "./modules/channels/channels.module.js";
import { ClientPortalModule } from "./modules/client-portal/client-portal.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { SettlementModule } from "./modules/settlement/settlement.module.js";
import { ReferenceModule } from "./modules/refdata/reference.module.js";
import { RulesModule } from "./modules/rules/rules.module.js";
import { TaskModule } from "./modules/task/task.module.js";
import { WorkModule } from "./modules/work/work.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";

/**
 * Root module. DbModule + AuditModule (global) and AuthModule (global guards:
 * AuthGuard then PermissionGuard) + module 0 (platform) are always on. Phase-1
 * modules 1–6 are added here behind feature flags as they're built.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(), // in-process cron (subscription reminders)
    DbModule,
    AuditModule,
    CryptoModule, // global AES-GCM (vault + 2FA-at-rest); VAULT_ENCRYPTION_KEY required at boot
    EmailModule, // global swappable email sender (reminders; dev adapter by default)
    WhatsAppModule, // global swappable WhatsApp sender (quote intake; dev no-op by default)
    AuthModule,
    PlatformModule,
    FilesModule, // core plumbing (file pipeline) — always on, reused across modules

    ...(isModuleEnabled("reference") ? [ReferenceModule] : []),
    ...(isModuleEnabled("work") ? [WorkModule, ProjectsModule] : []),
    ...(isModuleEnabled("rules") ? [RulesModule] : []),
    ...(isModuleEnabled("billing") ? [BillingModule, SettlementModule] : []),
    ...(isModuleEnabled("expenses") ? [ExpenseModule] : []),
    ...(isModuleEnabled("capture") ? [TaskModule] : []),
    ...(isModuleEnabled("outcomes") ? [OutcomesModule] : []),
    ...(isModuleEnabled("credential_vault") ? [CredentialVaultModule] : []),
    ...(isModuleEnabled("knowledge") ? [KnowledgeModule] : []),
    ...(isModuleEnabled("checks") ? [ChecksModule] : []),
    ...(isModuleEnabled("referrers") ? [ReferrersModule] : []),
    ...(isModuleEnabled("custom_fields") ? [CustomFieldsModule] : []),
    ...(isModuleEnabled("dashboard") ? [DashboardModule] : []),
    ...(isModuleEnabled("personal_finance") ? [PersonalFinanceModule] : []),
    ...(isModuleEnabled("ai_capture") ? [AiCaptureModule] : []),
    ...(isModuleEnabled("import_export") ? [ImportExportModule] : []),
    ...(isModuleEnabled("channels") ? [ChannelsModule] : []),
    ...(isModuleEnabled("client_portal") ? [ClientPortalModule] : []),
    ...(isModuleEnabled("notifications") ? [NotificationsModule] : []),
  ],
})
export class AppModule {}
