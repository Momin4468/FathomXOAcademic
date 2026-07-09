import { env } from "./env.js";
import { applyMigrations, SEED_FILES } from "./run-migrations.js";

async function main() {
  await applyMigrations(env.adminUrl, [...SEED_FILES]);
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
