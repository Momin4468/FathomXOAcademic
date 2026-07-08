import { env } from "./env.js";
import { applyMigrations, ensureAppRole } from "./run-migrations.js";

// Schema + RLS migrations (NOT the seed — that's `pnpm db:seed`).
const SCHEMA_MIGRATIONS = [
  "0000_init.sql",
  "0001_rls.sql",
  "0003_auth.sql",
  "0004_reference.sql",
  "0006_work.sql",
  "0007_rules.sql",
  "0008_comp_provenance.sql",
  "0009_billing.sql",
  "0010_billing_fixes.sql",
  "0011_expense_task.sql",
  "0012_expense_task_nodelete.sql",
  "0013_paid_amount_deprecate.sql",
  "0014_projects.sql",
  "0015_settlement.sql",
  "0016_platform_fee_unique.sql",
  "0017_outcomes.sql",
  "0018_credential_vault.sql",
  "0019_knowledge.sql",
  "0020_check_service.sql",
  "0021_referrers.sql",
  "0022_resit.sql",
  "0023_custom_fields.sql",
  "0024_dashboards.sql",
  "0025_hardening.sql",
  "0026_subscription_reminders.sql",
  "0027_personal_finance.sql",
  "0028_personal_notes.sql",
  "0029_analytics.sql",
  "0030_ai_capture.sql",
  "0031_import_export.sql",
  "0032_channels_profit_share.sql",
  "0033_client_portal.sql",
  "0034_password_reset.sql",
  "0035_pf_planner.sql",
  "0036_cost_bearer_party_ref.sql",
  "0037_payment_currency_other_income.sql",
  "0038_leg_reprice.sql",
  "0039_price_group.sql",
  "0040_client_first_login.sql",
  "0041_notifications.sql",
  "0042_advance_ledger.sql",
  "0043_vendor_claim.sql",
  "0044_producer_work_log.sql",
];

async function main() {
  // The app role must exist before 0001_rls.sql grants privileges to it.
  await ensureAppRole(env.adminUrl, env.appDbUser, env.appDbPassword);
  // The read-only BI role must exist before 0029_analytics.sql grants to it.
  await ensureAppRole(env.adminUrl, env.analyticsRoUser, env.analyticsRoPassword);
  await applyMigrations(env.adminUrl, SCHEMA_MIGRATIONS);
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
