import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { AdvancesService } from "./advances.service.js";
import { CreateAdvanceDto, CreateAdvanceEventDto } from "./dto.js";

/**
 * Module 20 — business-plane loan/advance ledger (P1 item 11). Admin-gated money
 * ledger: reads on advances:view, create/events on advances:create, reverse/archive
 * on advances:approve. Feature-flagged `advances`.
 */
@Controller("advances")
export class AdvancesController {
  constructor(
    private readonly db: DbService,
    private readonly advances: AdvancesService,
  ) {}

  @Post()
  @RequirePermission("advances", "create")
  create(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateAdvanceDto) {
    return this.db.withTenant(ctx, (tx) => this.advances.create(tx, p, dto));
  }

  @Get()
  @RequirePermission("advances", "view")
  list(
    @CurrentRls() ctx: RlsContext,
    @Query("counterpartyPartyId", new ParseUUIDPipe({ optional: true })) counterpartyPartyId?: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.advances.list(tx, counterpartyPartyId));
  }

  @Get("party/:partyId")
  @RequirePermission("advances", "view")
  partyOutstanding(@CurrentRls() ctx: RlsContext, @Param("partyId", ParseUUIDPipe) partyId: string) {
    return this.db.withTenant(ctx, (tx) => this.advances.partyOutstanding(tx, partyId));
  }

  @Get(":id")
  @RequirePermission("advances", "view")
  getOne(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.advances.getOne(tx, id));
  }

  @Post(":id/events")
  @RequirePermission("advances", "create")
  addEvent(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateAdvanceEventDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.advances.addEvent(tx, p, id, dto));
  }

  @Post("events/:eventId/reverse")
  @HttpCode(200)
  @RequirePermission("advances", "approve")
  reverseEvent(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.advances.reverseEvent(tx, p, eventId));
  }

  @Post(":id/archive")
  @HttpCode(200)
  @RequirePermission("advances", "approve")
  archive(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.advances.archive(tx, p, id));
  }
}
