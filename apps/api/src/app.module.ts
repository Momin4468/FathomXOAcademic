import { Module } from "@nestjs/common";
import { AuditModule } from "./common/audit/audit.module.js";
import { AuthModule } from "./common/auth/auth.module.js";
import { DbModule } from "./common/db/db.module.js";
import { isModuleEnabled } from "./feature-flags.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { ExpenseModule } from "./modules/expense/expense.module.js";
import { OutcomesModule } from "./modules/outcomes/outcomes.module.js";
import { CredentialVaultModule } from "./modules/credential-vault/credential-vault.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { SettlementModule } from "./modules/settlement/settlement.module.js";
import { ReferenceModule } from "./modules/refdata/reference.module.js";
import { RulesModule } from "./modules/rules/rules.module.js";
import { TaskModule } from "./modules/task/task.module.js";
import { WorkModule } from "./modules/work/work.module.js";

/**
 * Root module. DbModule + AuditModule (global) and AuthModule (global guards:
 * AuthGuard then PermissionGuard) + module 0 (platform) are always on. Phase-1
 * modules 1–6 are added here behind feature flags as they're built.
 */
@Module({
  imports: [
    DbModule,
    AuditModule,
    AuthModule,
    PlatformModule,
    ...(isModuleEnabled("reference") ? [ReferenceModule] : []),
    ...(isModuleEnabled("work") ? [WorkModule, ProjectsModule] : []),
    ...(isModuleEnabled("rules") ? [RulesModule] : []),
    ...(isModuleEnabled("billing") ? [BillingModule, SettlementModule] : []),
    ...(isModuleEnabled("expenses") ? [ExpenseModule] : []),
    ...(isModuleEnabled("capture") ? [TaskModule] : []),
    ...(isModuleEnabled("outcomes") ? [OutcomesModule] : []),
    ...(isModuleEnabled("credential_vault") ? [CredentialVaultModule] : []),
  ],
})
export class AppModule {}
