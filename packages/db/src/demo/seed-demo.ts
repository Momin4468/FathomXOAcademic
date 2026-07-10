import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seedDemo, DEMO_ORG } from "./demo-data.js";

// Load repo-root .env (../../../.env from packages/db/src/demo).
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env");
if (existsSync(rootEnv)) config({ path: rootEnv });

/**
 * Seed the cordoned "Demo Org — Training" (Phase 6). Re-runnable (wipes the demo
 * org first). Connects as the admin/owner (bypasses RLS). NEVER touches any other
 * org. Every login is Password123!.
 */
async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) throw new Error("DATABASE_URL_ADMIN is not set");
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await seedDemo(client);
    console.log(`✓ Demo org seeded (${DEMO_ORG}).`);
    console.log("  Logins (all Password123!): sysadmin@demo.local, momin@demo.local, emon@demo.local,");
    console.log("  humaira@demo.local, mitul@demo.local, toma@demo.local, lemon@demo.local · PF: pf-demo@demo.local");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
