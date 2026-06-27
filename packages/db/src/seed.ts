import { env } from "./env.js";
import { applyMigrations } from "./run-migrations.js";

async function main() {
  await applyMigrations(env.adminUrl, ["0002_seed.sql", "0005_seed_reference.sql"]);
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
