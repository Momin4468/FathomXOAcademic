import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { DecideVendorClaimDto, SubmitVendorClaimDto } from "./dto.js";
import { VendorService } from "./vendor.service.js";

/**
 * Module 21 — vendor self-service (audit item 13). `/vendor/*` is the vendor's OWN
 * slice (vendor:view/create, self-scoped by partyId); `/vendor-admin/*` is the
 * admin review queue (vendor:approve). Business plane — no separate login. Gated
 * `FEATURE_VENDOR`.
 */
@Controller()
export class VendorController {
  constructor(
    private readonly db: DbService,
    private readonly vendor: VendorService,
  ) {}

  /** The vendor self-view — own balance + own handoff legs + own claims. */
  @Get("vendor/me")
  @RequirePermission("vendor", "view")
  me(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.vendor.me(tx, p));
  }

  @Post("vendor/claims")
  @RequirePermission("vendor", "create")
  submit(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: SubmitVendorClaimDto) {
    return this.db.withTenant(ctx, (tx) => this.vendor.submitClaim(tx, p, dto));
  }

  /** The admin review queue (all claims, optionally by status). */
  @Get("vendor-admin/claims")
  @RequirePermission("vendor", "approve")
  listClaims(@CurrentRls() ctx: RlsContext, @Query("status") status?: string) {
    return this.db.withTenant(ctx, (tx) => this.vendor.listClaims(tx, status));
  }

  @Post("vendor-admin/claims/:id/decide")
  @RequirePermission("vendor", "approve")
  decide(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DecideVendorClaimDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.vendor.decide(tx, p, id, dto));
  }
}
