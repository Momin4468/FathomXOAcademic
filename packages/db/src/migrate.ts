import { env } from "./env.js";
import { applyMigrations, ensureAppRole } from "./run-migrations.js";

// Schema + RLS migrations (NOT the seed — that's `pnpm db:seed`).
const SCHEMA_MIGRATIONS = ["0000_init.sql", "0001_rls.sql"];

async function main() {
  // The app role must exist before 0001_rls.sql grants privileges to it.
  await ensureAppRole(env.adminUrl, env.appDbUser, env.appDbPassword);
  await applyMigrations(env.adminUrl, SCHEMA_MIGRATIONS);
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
