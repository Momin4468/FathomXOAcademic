import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { wipeDemo, DEMO_ORG } from "./demo-data.js";

const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env");
if (existsSync(rootEnv)) config({ path: rootEnv });

/**
 * Wipe the "Demo Org — Training" in ONE action — business plane by org_id, PF plane
 * by pf_account_id. Zero effect on any other org. Connects as admin/owner.
 */
async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) throw new Error("DATABASE_URL_ADMIN is not set");
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await wipeDemo(client);
    console.log(`✓ Demo org wiped (${DEMO_ORG}). No other org touched.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
