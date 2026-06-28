import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { ListOutcomesQueryDto, RecordOutcomeDto, UpdateOutcomeDto, WriterProfileDto } from "./dto.js";
import { OutcomeService } from "./outcome.service.js";

/**
 * Module 7 — per-work outcomes + derived reputation + writer capacity (§8).
 * Gated by the `outcomes` permission module. Outcomes are never self-reported
 * (service guard); reputation/course-history/load are derived read-models.
 */
@Controller("outcomes")
export class OutcomesController {
  constructor(
    private readonly db: DbService,
    private readonly outcomes: OutcomeService,
  ) {}

  @Post()
  @RequirePermission("outcomes", "create")
  record(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: RecordOutcomeDto) {
    return this.db.withTenant(ctx, (tx) => this.outcomes.record(tx, p, dto));
  }

  @Patch(":id")
  @RequirePermission("outcomes", "edit")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateOutcomeDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.outcomes.update(tx, p, id, dto));
  }

  @Get()
  @RequirePermission("outcomes", "view")
  list(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Query() q: ListOutcomesQueryDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.outcomes.list(tx, p, perms, q));
  }

  /** The writer's derived reputation read-model (own-or-admin). */
  @Get("reputation/:partyId")
  @RequirePermission("outcomes", "view")
  reputation(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("partyId", ParseUUIDPipe) partyId: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.outcomes.getReputation(tx, p, perms, partyId));
  }

  /** The consolidated writer card: profile + reputation + course history + load. */
  @Get("writers/:partyId")
  @RequirePermission("outcomes", "view")
  writerCard(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("partyId", ParseUUIDPipe) partyId: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.outcomes.getWriterCard(tx, p, perms, partyId));
  }

  /** Edit a writer's expertise/availability — own party, or an admin. */
  @Patch("writers/:partyId/profile")
  @RequirePermission("outcomes", "view")
  updateProfile(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("partyId", ParseUUIDPipe) partyId: string,
    @Body() dto: WriterProfileDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.outcomes.updateProfile(tx, p, perms, partyId, dto));
  }
}
