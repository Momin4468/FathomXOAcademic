/**
 * The shape of the per-request security context that the API sets as Postgres
 * session GUCs inside each transaction (spec §4, SCHEMA RLS conventions).
 *
 * These three values + leg-membership ARE the visibility model. The DB reads
 * them via current_setting('app.*'); the app never decides row visibility itself.
 */
export interface RlsContext {
  /** Tenant scope — every row is filtered by this (CLAUDE.md §3.1). */
  orgId: string;
  /**
   * The acting party (the human's `party` row), used by the leg-visibility policy:
   * a user may read a leg only if their party is from/to on it. Null for system
   * connections that act purely as superadmin.
   */
  partyId: string | null;
  /**
   * Break-glass / business-superadmin bypass of the leg policy. MUST be granted
   * deliberately and is always audited (spec §4.2/§4.4). Never the default.
   */
  isSuperadmin: boolean;
}

/** GUC names — kept in one place so the SQL helpers and the TS setter agree. */
export const GUC = {
  orgId: "app.org_id",
  partyId: "app.current_party_id",
  isSuperadmin: "app.is_superadmin",
  /** The PERSONAL-FINANCE plane scope (§11). Disjoint from the business GUCs:
   *  a business transaction never sets it, so the business — even SuperAdmin —
   *  reads zero pf_* rows. A pf transaction sets ONLY this (business GUCs empty). */
  pfAccountId: "app.pf_account_id",
} as const;

/**
 * The per-request scope for the PERSONAL-FINANCE plane (§11). The PF plane's
 * tenant unit is the ACCOUNT itself (a standalone PF user has no org), so this is
 * the PF analogue of RlsContext.orgId. Set as `app.pf_account_id`; pf_* RLS
 * policies filter every row by it and do NOT honor the business superadmin GUC.
 */
export interface PfRlsContext {
  pfAccountId: string;
}
