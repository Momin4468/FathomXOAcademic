/**
 * The authenticated principal — derived from the SIGNED access token on every
 * request (never from client-supplied headers). The RLS context is built from
 * this (see RlsContext): orgId/partyId scope the tenant + leg visibility, and
 * isSystemSuperadmin is the ONLY thing that sets the leg-bypass GUC (spec §4.4 —
 * Business SuperAdmin does NOT get it).
 */
export interface SessionPrincipal {
  userId: string;
  orgId: string;
  partyId: string | null;
  isSystemSuperadmin: boolean;
}

/** Role names that are seeded as system defaults (spec §4.3). */
export const SYSTEM_SUPERADMIN_ROLE = "System SuperAdmin";
export const BUSINESS_SUPERADMIN_ROLE = "Business SuperAdmin";

/** Access-token lifetime and the sliding refresh window (auth policy). */
export const ACCESS_TOKEN_TTL = "30m";
export const REFRESH_TOKEN_TTL_DAYS = 10;
