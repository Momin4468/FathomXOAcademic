import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { withRlsTransaction, type Db } from "@business-os/db";
import type { RlsContext } from "@business-os/shared";
import type pg from "pg";
import { PG_POOL } from "./db.constants.js";

/** Minimal auth columns returned by the app_auth_lookup() SECURITY DEFINER fn. */
export interface AuthLookupRow {
  id: string;
  org_id: string;
  party_id: string | null;
  password_hash: string;
  status: string;
  twofa_secret: string | null;
}

/**
 * The single data access layer (CLAUDE.md §3.1). All tenant work goes through
 * `withTenant`, which opens a transaction, sets the RLS session GUCs from the
 * request's security context, and only then runs the callback — so the database
 * enforces visibility, not the application.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  withTenant<T>(ctx: RlsContext, fn: (tx: Db) => Promise<T>): Promise<T> {
    return withRlsTransaction(this.pool, ctx, fn);
  }

  /**
   * Credential lookup for login. Runs the app_auth_lookup() SECURITY DEFINER
   * function with NO RLS context set — by design, because the org isn't known
   * until the user is identified. The function (owner-rights) is the single
   * sanctioned RLS bypass and returns only auth columns for the one email.
   */
  async authLookup(email: string): Promise<AuthLookupRow | null> {
    const client = await this.pool.connect();
    try {
      const res = await client.query<AuthLookupRow>(
        "select id, org_id, party_id, password_hash, status, twofa_secret from app_auth_lookup($1)",
        [email],
      );
      return res.rows[0] ?? null;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
