import { Controller, Get } from "@nestjs/common";
import type { SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { MetabaseEmbedService } from "./metabase-embed.service.js";

/**
 * Embedded analytics (DESIGN_SPEC §8). Returns a signed Metabase embed URL scoped
 * to the viewer's role: the owner dashboard (locked org_id) for an analytics
 * approver, else a member "my numbers" dashboard (locked org_id + party_id). The
 * lock is server-minted, so a viewer can never widen scope; and Metabase reads
 * only the redacted `analytics` views (no base tables) regardless.
 */
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly embed: MetabaseEmbedService) {}

  @Get("embed")
  @RequirePermission("dashboard", "view")
  embedToken(
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
  ) {
    const isApprover = principal.isSystemSuperadmin || perms.perms.has("dashboard:approve");
    return this.embed.embedFor(principal, isApprover);
  }
}
