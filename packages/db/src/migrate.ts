import { env } from "./env.js";
import { applyMigrations, discoverSchemaMigrations, ensureAppRole } from "./run-migrations.js";

async function main() {
  // The app role must exist before 0001_rls.sql grants privileges to it.
  await ensureAppRole(env.adminUrl, env.appDbUser, env.appDbPassword);
  // The read-only BI role must exist before 0029_analytics.sql grants to it.
  await ensureAppRole(env.adminUrl, env.analyticsRoUser, env.analyticsRoPassword);
  // Auto-discovered from the migrations dir (minus seeds) — a new .sql can never
  // be forgotten by omission from a hand-maintained list.
  await applyMigrations(env.adminUrl, discoverSchemaMigrations());
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
