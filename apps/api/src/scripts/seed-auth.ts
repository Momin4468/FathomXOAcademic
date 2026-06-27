import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import pg from "pg";

// Load repo-root .env (../../../.env from apps/api/src/scripts).
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env");
if (existsSync(rootEnv)) config({ path: rootEnv });

/**
 * Dev-only: set real bcrypt password hashes on the four seeded users (0002_seed)
 * so login works locally. Re-runnable. Connects as the admin/owner (bypasses
 * RLS). NOT for production — these are well-known dev credentials.
 */
const DEV_PASSWORD = "Password123!";
const SEED_EMAILS = [
  "sysadmin@fathomxo.local",
  "bizadmin@fathomxo.local",
  "momin@fathomxo.local",
  "emon@fathomxo.local",
];

async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) throw new Error("DATABASE_URL_ADMIN is not set");

  const hash = await bcrypt.hash(DEV_PASSWORD, 12);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const res = await client.query(
      `update user_account set password_hash = $1, updated_at = now()
       where email = any($2::citext[])`,
      [hash, SEED_EMAILS],
    );
    console.log(`✓ set dev password on ${res.rowCount} user(s).`);
    console.log(`  credentials: <one of ${SEED_EMAILS.join(", ")}> / ${DEV_PASSWORD}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
