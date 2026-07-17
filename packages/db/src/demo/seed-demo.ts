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
    console.log(`✓ Demo org seeded (${DEMO_ORG}). All passwords: Password123!`);
    console.log("  Business logins (/login):");
    console.log("    sysadmin@demo.local  — System SuperAdmin (owner; sees every leg/real price)");
    console.log("    momin@demo.local     — Admin + Writer (partner; sees his REAL client prices)");
    console.log("    emon@demo.local      — Admin + Writer (sees the declared/pool prices, not Momin's)");
    console.log("    humaira@demo.local   — Writer (own tasks + My fee; no client prices)");
    console.log("    mitul@demo.local     — Writer");
    console.log("    lemon@demo.local     — Partner + Referrer (own share/referrals only)");
    console.log("    toma@demo.local      — Vendor (own jobs/statement)");
    console.log("    fahim@demo.local     — Employee (logs work; no prices)");
    console.log("  Client portal (/portal): mujahid@demo.local");
    console.log("  Personal Finance (/personal-finance): pf-demo@demo.local");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
