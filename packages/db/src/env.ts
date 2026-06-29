import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load the repo-root .env (two levels up from packages/db) if present.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env");
if (existsSync(rootEnv)) config({ path: rootEnv });
else config(); // fall back to process env / local .env

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  /** Admin/owner connection — runs DDL, migrations, seed (bypasses RLS). */
  adminUrl: required("DATABASE_URL_ADMIN"),
  /** App connection — the non-owner role; RLS is ENFORCED on it. */
  appUrl: required("DATABASE_URL"),
  appDbUser: process.env.APP_DB_USER ?? "app_user",
  appDbPassword: process.env.APP_DB_PASSWORD ?? "app_user_pw",
  /** Read-only BI role (Metabase connects as this; SELECT on the analytics schema only). */
  analyticsRoUser: process.env.ANALYTICS_RO_USER ?? "analytics_ro",
  analyticsRoPassword: process.env.ANALYTICS_RO_PASSWORD ?? "analytics_ro_pw",
};
