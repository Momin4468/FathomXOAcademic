import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { withPfRlsTransaction, withRlsTransaction, type Db } from "@business-os/db";
import type { PfRlsContext, RlsContext } from "@business-os/shared";
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

/** Minimal auth columns returned by the pf_auth_lookup() SECURITY DEFINER fn (§11). */
export interface PfAuthLookupRow {
  id: string;
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
   * The PERSONAL-FINANCE access layer (§11). Opens a transaction scoped to ONE pf
   * account (sets app.pf_account_id, blanks the business GUCs). Every pf_* query
   * inside is account-isolated by RLS, and no business context can reach in.
   */
  withPfAccount<T>(ctx: PfRlsContext, fn: (tx: Db) => Promise<T>): Promise<T> {
    return withPfRlsTransaction(this.pool, ctx, fn);
  }

  /**
   * PF credential lookup for login — the PF analogue of authLookup. Runs the
   * pf_auth_lookup() SECURITY DEFINER with NO context (the account isn't known
   * until the email is matched). Returns only auth columns for the one email.
   */
  async pfAuthLookup(email: string): Promise<PfAuthLookupRow | null> {
    const client = await this.pool.connect();
    try {
      const res = await client.query<PfAuthLookupRow>(
        "select id, password_hash, status, twofa_secret from pf_auth_lookup($1)",
        [email],
      );
      return res.rows[0] ?? null;
    } finally {
      client.release();
    }
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

  /**
   * Self-service PF account creation (§11). Runs the pf_register() SECURITY
   * DEFINER with NO context (no account exists pre-registration). Returns the new
   * account id, or null if the email is already taken (caller maps null → 409).
   */
  async pfRegister(
    email: string,
    passwordHash: string,
    displayName: string | null,
    baseCurrency: string,
  ): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      const res = await client.query<{ pf_register: string | null }>(
        "select pf_register($1, $2, $3, $4) as pf_register",
        [email, passwordHash, displayName, baseCurrency],
      );
      return res.rows[0]?.pf_register ?? null;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
