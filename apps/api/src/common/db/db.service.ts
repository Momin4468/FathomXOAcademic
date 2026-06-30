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

/** Auth columns returned by the client_auth_lookup() SECURITY DEFINER fn (Module 18). */
export interface ClientAuthLookupRow {
  id: string;
  org_id: string;
  party_id: string;
  password_hash: string;
  status: string;
  twofa_secret: string | null;
  expires_at: Date | null;
}

/** The three auth planes a reset token can belong to (matches the DB check). */
export type ResetPlane = "business" | "pf" | "client";

/** Row returned by client_reset_lookup() — the account + the email to send to. */
export interface ClientResetLookupRow {
  id: string;
  status: string;
  expires_at: Date | null;
  email: string | null;
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
  /**
   * Client-portal credential lookup for login (Module 18). Runs the
   * client_auth_lookup() SECURITY DEFINER with NO context (the org/party aren't
   * known until the login_id is matched). Returns auth columns + the org/party so
   * the token can carry them. The client plane then uses withTenant scoped to that
   * party — no new GUC (the data is business data).
   */
  async clientAuthLookup(loginId: string): Promise<ClientAuthLookupRow | null> {
    const client = await this.pool.connect();
    try {
      const res = await client.query<ClientAuthLookupRow>(
        "select id, org_id, party_id, password_hash, status, twofa_secret, expires_at from client_auth_lookup($1)",
        [loginId],
      );
      return res.rows[0] ?? null;
    } finally {
      client.release();
    }
  }

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

  /**
   * Client reset lookup — resolve a client reset request (by login_id) to the
   * email we should send the link to. Pre-auth (no context); mirror of
   * clientAuthLookup. Returns the account + the contact email (login_id fallback).
   */
  async clientResetLookup(loginId: string): Promise<ClientResetLookupRow | null> {
    const client = await this.pool.connect();
    try {
      const res = await client.query<ClientResetLookupRow>(
        "select id, status, expires_at, email from client_reset_lookup($1)",
        [loginId],
      );
      return res.rows[0] ?? null;
    } finally {
      client.release();
    }
  }

  /**
   * Store a hashed, expiring password-reset token. Pre-auth (no context); runs the
   * pwreset_request() SECURITY DEFINER, which first invalidates any prior live token
   * for the account so only the newest link works. The raw token is never stored.
   */
  async pwResetRequest(
    plane: ResetPlane,
    accountId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("select pwreset_request($1, $2, $3, $4)", [
        plane,
        accountId,
        tokenHash,
        expiresAt,
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Consume a password-reset token and set the new password atomically (owner
   * rights — the consume definer also revokes ALL the account's live refresh tokens
   * and audits). Pre-auth (no context). Returns the account id on success, or null
   * when there is no live token (invalid/expired/used) — the caller maps null to a
   * single generic error so the response can't be used to enumerate accounts.
   */
  async pwResetConsume(
    plane: ResetPlane,
    tokenHash: string,
    newPasswordHash: string,
  ): Promise<string | null> {
    const fn =
      plane === "business"
        ? "pwreset_consume_business"
        : plane === "pf"
          ? "pwreset_consume_pf"
          : "pwreset_consume_client";
    const client = await this.pool.connect();
    try {
      const res = await client.query<{ account_id: string | null }>(
        `select ${fn}($1, $2) as account_id`,
        [tokenHash, newPasswordHash],
      );
      return res.rows[0]?.account_id ?? null;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
