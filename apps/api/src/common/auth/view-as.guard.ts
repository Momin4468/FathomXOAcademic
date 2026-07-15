import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { schema } from "@business-os/db";
import type { SessionPrincipal } from "@business-os/shared";
import { and, eq } from "drizzle-orm";
import type { Request } from "express";
import { DbService } from "../db/db.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * "View as" preview (handoff — the sidebar role switcher). A System SuperAdmin may
 * PREVIEW the app scoped to another party (see what a writer/partner/vendor sees).
 * Two guarantees, both enforced here (runs after AuthGuard, before PermissionGuard):
 *
 *  1. READ-ONLY — any state-changing request carrying `x-view-as` is rejected, so a
 *     superadmin can never write while impersonating.
 *  2. FAITHFUL — we SWAP the whole request identity to the previewed party (its
 *     linked login's userId, its partyId, superadmin OFF). Because everything
 *     downstream reads `req.principal` — endpoint authz (PermissionGuard),
 *     `canSeeMoney`/`canSeeContact`, the leg-RLS ctx, `job_pnl`, and whoami's
 *     persona — the preview obeys EXACTLY the previewed party's visibility. A
 *     party with no login previews as a no-permission viewer (RLS-granted rows
 *     only). The bypass GUC is never set for the previewed identity, so §4.4 holds.
 *
 * Honored ONLY for a token-verified superadmin; a forged header/cookie from anyone
 * else is inert (identity stays token-derived).
 */
@Injectable()
export class ViewAsGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { principal?: SessionPrincipal }>();
    const header = req.headers["x-view-as"];
    if (typeof header !== "string" || !header.trim()) return true;

    const principal = req.principal;
    if (!principal?.isSystemSuperadmin) return true; // forged by a non-superadmin → inert

    const safe = req.method === "GET" || req.method === "HEAD";
    if (!safe) {
      throw new ForbiddenException("Read-only while viewing as another user — exit the preview to make changes.");
    }
    const previewParty = header.trim();
    if (!UUID_RE.test(previewParty)) return true; // malformed → ignore, stay the superadmin

    // Resolve the previewed party's linked login (org-scoped; superadmin sees all).
    const superCtx = { orgId: principal.orgId, partyId: principal.partyId, isSuperadmin: true };
    const linkedUserId = await this.db.withTenant(superCtx, async (tx) => {
      const [u] = await tx
        .select({ id: schema.userAccount.id })
        .from(schema.userAccount)
        .where(and(eq(schema.userAccount.partyId, previewParty), eq(schema.userAccount.orgId, principal.orgId)));
      return u?.id ?? null;
    });

    // Swap the identity. A login-less party gets NIL_UUID → zero effective perms.
    req.principal = {
      userId: linkedUserId ?? NIL_UUID,
      orgId: principal.orgId,
      partyId: previewParty,
      isSystemSuperadmin: false,
    };
    return true;
  }
}
