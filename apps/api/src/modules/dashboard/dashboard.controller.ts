import { Controller, Get } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { DashboardService } from "./dashboard.service.js";

/**
 * Module 13 — role-scoped dashboards (§8, §10). No @RequirePermission: any
 * authenticated viewer gets their OWN "my numbers" (self-scoped under RLS, like
 * /platform/whoami & /billing/balance/me); the owner analytics section is gated
 * INSIDE the service by `dashboard:approve` so the API returns only what the
 * viewer may see. `dashboard:view` is seeded to every role, so the gate is
 * effectively "any authenticated user" while still loading req.permissions.
 */
@Controller("dashboard")
export class DashboardController {
  constructor(
    private readonly db: DbService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get()
  @RequirePermission("dashboard", "view")
  get(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
  ) {
    return this.db.withTenant(ctx, (tx) => this.dashboard.getDashboard(tx, principal, perms));
  }
}
