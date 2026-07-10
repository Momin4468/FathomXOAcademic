import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { CreateOpeningBalanceDto } from "./opening-balance.dto.js";
import { OpeningBalanceService } from "./opening-balance.service.js";

/**
 * Opening-balance admin (Phase 5). A clearly-labeled, dated starting point per
 * party / the business overall — gated by the `billing` permission (it's money
 * setup). Append-only: corrections are reversing entries, never edits.
 */
@Controller("opening-balances")
export class OpeningBalanceController {
  constructor(
    private readonly db: DbService,
    private readonly openings: OpeningBalanceService,
  ) {}

  @Post()
  @RequirePermission("billing", "approve")
  create(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreateOpeningBalanceDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.openings.create(tx, principal, dto));
  }

  @Get()
  @RequirePermission("billing", "view")
  list(
    @CurrentRls() ctx: RlsContext,
    @Query("partyId") partyId?: string,
    @Query("scope") scope?: string,
  ) {
    return this.db.withTenant(ctx, (tx) =>
      this.openings.list(tx, { partyId, business: scope === "business" }),
    );
  }

  @Post(":id/reverse")
  @RequirePermission("billing", "approve")
  reverse(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.openings.reverse(tx, principal, id));
  }
}
