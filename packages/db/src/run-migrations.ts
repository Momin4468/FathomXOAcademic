import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
export const migrationsDir = resolve(here, "../migrations");

/**
 * Apply a list of .sql files exactly once, tracked in schema_migrations.
 * Each file runs inside its own transaction. Runs as the admin/owner connection
 * (which bypasses RLS), so DDL and seeds work regardless of policies.
 */
export async function applyMigrations(
  adminUrl: string,
  files: string[],
): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    for (const file of files) {
      const { rows } = await client.query(
        "select 1 from schema_migrations where filename = $1",
        [file],
      );
      if (rows.length > 0) {
        console.log(`• skip  ${file} (already applied)`);
        continue;
      }
      const sqlText = await readFile(join(migrationsDir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sqlText);
        await client.query(
          "insert into schema_migrations (filename) values ($1)",
          [file],
        );
        await client.query("commit");
        console.log(`✓ apply ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
  } finally {
    await client.end();
  }
}

/**
 * Ensure the non-owner app role exists with the configured password and can
 * connect. Idempotent. Must run before 0001_rls.sql (which grants to it).
 */
export async function ensureAppRole(
  adminUrl: string,
  user: string,
  password: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select 1 from pg_roles where rolname = $1",
      [user],
    );
    // pg cannot parameterize identifiers; user/password are from our own env.
    const ident = '"' + user.replace(/"/g, '""') + '"';
    const lit = "'" + password.replace(/'/g, "''") + "'";
    if (rows.length === 0) {
      await client.query(
        `create role ${ident} login password ${lit} nosuperuser nocreatedb nocreaterole`,
      );
      console.log(`✓ created role ${user}`);
    } else {
      await client.query(`alter role ${ident} login password ${lit}`);
      console.log(`• role ${user} exists (password synced)`);
    }
    // Database-level connect (PUBLIC usually has it, but be explicit).
    const dbName = new URL(adminUrl).pathname.replace(/^\//, "");
    await client.query(
      `grant connect on database "${dbName.replace(/"/g, '""')}" to ${ident}`,
    );
  } finally {
    await client.end();
  }
}
