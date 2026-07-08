import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { ChannelsService } from "./channels.service.js";
import {
  CreateChannelDto,
  ListProfitShareTermsQueryDto,
  MyProfitShareQueryDto,
  SetProfitShareTermDto,
  UpdateChannelDto,
} from "./dto.js";

/**
 * Module 17 — Channels + source routing + N-way profit-share (§3, §4.4). Admins
 * (channels:approve) create/tune channels, set profit-share terms, and view a
 * job's pool division (money). A sharer (channels:view) sees ONLY their own cut
 * via GET /channels/profit-share/mine (the my_profit_share definer enforces "own"
 * and the §4.4 per-job/aggregate split).
 */
@Controller("channels")
export class ChannelsController {
  constructor(
    private readonly db: DbService,
    private readonly channels: ChannelsService,
  ) {}

  // ── sharer self-view (own cuts only) ──────────────────────────────────────────
  @Get("profit-share/mine")
  @RequirePermission("channels", "view")
  myProfitShare(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Query() q: MyProfitShareQueryDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.channels.myProfitShare(tx, p, q));
  }

  // ── the caller's own running settlement balance (accrual − transfers) ─────────
  @Get("settlement-balance/mine")
  @RequirePermission("channels", "view")
  mySettlementBalance(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.channels.mySettlementBalance(tx, p));
  }

  // ── profit-share terms ────────────────────────────────────────────────────────
  @Get("profit-shares")
  @RequirePermission("channels", "view")
  listProfitShareTerms(@CurrentRls() ctx: RlsContext, @Query() q: ListProfitShareTermsQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.channels.listProfitShareTerms(tx, q.partyId));
  }

  @Post("profit-shares")
  @RequirePermission("channels", "approve")
  setProfitShareTerm(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() dto: SetProfitShareTermDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.channels.setProfitShareTerm(tx, p, dto));
  }

  // ── per-job pool view (money — admins only) ───────────────────────────────────
  @Get("jobs/:id/profit-shares")
  @RequirePermission("channels", "approve")
  jobProfitShares(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.channels.jobProfitShares(tx, id));
  }

  // ── channels CRUD ─────────────────────────────────────────────────────────────
  @Get()
  @RequirePermission("channels", "view")
  list(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.channels.listChannels(tx));
  }

  @Post()
  @RequirePermission("channels", "create")
  create(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() dto: CreateChannelDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.channels.createChannel(tx, p, dto));
  }

  @Patch(":id")
  @RequirePermission("channels", "edit")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.channels.updateChannel(tx, p, id, dto));
  }

  @Delete(":id")
  @RequirePermission("channels", "edit")
  archive(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.channels.archiveChannel(tx, p, id));
  }
}
