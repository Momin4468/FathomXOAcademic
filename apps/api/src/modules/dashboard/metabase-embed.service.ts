import { createHmac } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { SessionPrincipal } from "@business-os/shared";

/** base64url without padding (JWT segment encoding). */
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Metabase signed-embedding (DESIGN_SPEC §8). Mints the short-lived HS256 JWT
 * Metabase requires to render a LOCKED dashboard. The locked `params` (org_id,
 * and party_id for a member) are the role-scope: Metabase forbids the viewer
 * changing a locked param, so a writer can never widen scope to another party or
 * org. Signed with METABASE_EMBED_SECRET (distinct from the app's JWT_SECRET) and
 * never sent to the browser as a reusable secret — only the assembled iframe URL.
 *
 * The token is a thin scope-lock on top of the real guarantee: Metabase connects
 * as `analytics_ro`, which can read only the redacted `analytics` views (no base
 * tables) — so even an unscoped query can't surface a leg/private margin.
 */
@Injectable()
export class MetabaseEmbedService {
  private secret(): string {
    const s = process.env.METABASE_EMBED_SECRET;
    if (!s || s.length < 32) {
      throw new NotFoundException("Analytics is not configured"); // 404, not a 500 that leaks intent
    }
    return s;
  }

  private siteUrl(): string {
    return (process.env.METABASE_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  private dashboardId(which: "owner" | "member"): number {
    const raw = which === "owner" ? process.env.METABASE_DASHBOARD_OWNER : process.env.METABASE_DASHBOARD_MEMBER;
    const id = Number(raw);
    if (!raw || !Number.isInteger(id) || id <= 0) {
      throw new NotFoundException("Analytics dashboard is not configured");
    }
    return id;
  }

  /** Sign a Metabase embedding JWT: { resource:{dashboard}, params:{locked}, exp }. */
  private sign(dashboardId: number, params: Record<string, string>): string {
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({
        resource: { dashboard: dashboardId },
        params,
        exp: Math.floor(Date.now() / 1000) + 10 * 60, // 10-minute embed token
      }),
    );
    const sig = b64url(createHmac("sha256", this.secret()).update(`${header}.${payload}`).digest());
    return `${header}.${payload}.${sig}`;
  }

  private embedUrl(token: string): string {
    return `${this.siteUrl()}/embed/dashboard/${token}#bordered=true&titled=true`;
  }

  /**
   * Choose the dashboard + LOCK the params for this viewer:
   *  • owner/SuperAdmin (dashboard:approve) → owner dashboard, locked org_id only;
   *    System SuperAdmin additionally gets the ad-hoc explorer link.
   *  • else a party-linked member → member dashboard, locked org_id + party_id.
   *  • no party + no approve → nothing to show.
   */
  embedFor(principal: SessionPrincipal, isApprover: boolean): {
    url: string;
    scope: "owner" | "member";
    canAdhoc: boolean;
    adhocUrl?: string;
  } {
    if (isApprover) {
      const url = this.embedUrl(this.sign(this.dashboardId("owner"), { org_id: principal.orgId }));
      const canAdhoc = principal.isSystemSuperadmin;
      return { url, scope: "owner", canAdhoc, ...(canAdhoc ? { adhocUrl: this.siteUrl() } : {}) };
    }
    if (principal.partyId) {
      const url = this.embedUrl(
        this.sign(this.dashboardId("member"), { org_id: principal.orgId, party_id: principal.partyId }),
      );
      return { url, scope: "member", canAdhoc: false };
    }
    throw new NotFoundException("No analytics available for this account");
  }
}
