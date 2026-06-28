import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import type { PfRlsContext, RlsContext } from "@business-os/shared";
import * as schema from "./schema/index.js";

export { schema };
/** A Drizzle handle bound to our schema (over either a Pool or a pooled client). */
export type Db = NodePgDatabase<typeof schema>;

/** Create a pg Pool for the given connection string. */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

/** Wrap a Pool as a Drizzle db with our schema. */
export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

/**
 * THE ACCESS LAYER (CLAUDE.md §3.1). Runs `fn` inside a single transaction whose
 * first act is to set the transaction-local RLS GUCs from `ctx`. Every query in
 * `fn` therefore executes under DB-enforced visibility — no query can escape org
 * scoping or the leg-visibility policy. Commits on success, rolls back on throw.
 *
 * The connection MUST be the non-owner app role for RLS to bind (owners/superusers
 * bypass RLS).
 */
export async function withRlsTransaction<T>(
  pool: pg.Pool,
  ctx: RlsContext,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // set_config(name, value, is_local=true) => scoped to this transaction.
    await client.query(
      "select set_config('app.org_id', $1, true), " +
        "set_config('app.current_party_id', $2, true), " +
        "set_config('app.is_superadmin', $3, true)",
      [ctx.orgId, ctx.partyId ?? "", ctx.isSuperadmin ? "true" : "false"],
    );
    const tx = drizzle(client, { schema });
    const result = await fn(tx);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * THE PERSONAL-FINANCE ACCESS LAYER (§11). The PF plane is a separate tenancy
 * domain scoped by `app.pf_account_id` (its analogue of org_id). This sets ONLY
 * the pf GUC and explicitly BLANKS the business GUCs, so:
 *   • pf_* RLS (using pf_account_id = app_current_pf_account()) binds to this
 *     account and no other — one account can never read another's rows; AND
 *   • a business transaction (which never sets app.pf_account_id) reads zero
 *     pf_* rows, SuperAdmin included — the two planes are disjoint at the DB.
 * Same non-owner app role as the business layer, so RLS actually binds.
 */
export async function withPfRlsTransaction<T>(
  pool: pg.Pool,
  ctx: PfRlsContext,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Set the pf scope AND blank the business scope (defensive — GUCs are tx-local
    // anyway, but this makes the plane boundary explicit on every pf transaction).
    await client.query(
      "select set_config('app.pf_account_id', $1, true), " +
        "set_config('app.org_id', '', true), " +
        "set_config('app.current_party_id', '', true), " +
        "set_config('app.is_superadmin', 'false', true)",
      [ctx.pfAccountId],
    );
    const tx = drizzle(client, { schema });
    const result = await fn(tx);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Re-export sql for convenience in callers. */
export { sql };
