import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import {
  AddLineDto,
  AppendLegsDto,
  CreatePriceGroupDto,
  CreateBundleDto,
  CreateWorkItemDto,
  FanOutDto,
  HandoffDto,
  ListWorkQueryDto,
  RepriceLegDto,
  ResitDto,
  SetLineStatusDto,
  ShareDto,
  TransitionDto,
  UpdateLineDto,
  UpdateWorkItemDto,
} from "./dto.js";
import { LegService } from "./leg.service.js";
import { LineService } from "./line.service.js";
import { PriceGroupService } from "./price-group.service.js";
import { ResitService } from "./resit.service.js";
import { WorkService } from "./work.service.js";

/** Whether the caller may see money fields on work_line (the redaction gate). */
function canSeeMoney(principal: SessionPrincipal, perms: EffectivePermissions): boolean {
  return principal.isSystemSuperadmin || perms.perms.has("work:approve");
}

@Controller("work")
export class WorkController {
  constructor(
    private readonly db: DbService,
    private readonly work: WorkService,
    private readonly lines: LineService,
    private readonly legs: LegService,
    private readonly resits: ResitService,
    private readonly priceGroups: PriceGroupService,
  ) {}

  /** Ad-hoc bulk pricing: group N consumer lines under one combined price (item 9). */
  @Post("price-groups")
  @RequirePermission("work", "approve")
  createPriceGroup(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreatePriceGroupDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.priceGroups.createGroup(tx, principal, dto));
  }

  @Get("price-groups/:id")
  @RequirePermission("work", "view")
  getPriceGroup(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.priceGroups.getGroup(tx, id));
  }

  @Post()
  @RequirePermission("work", "create")
  create(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Body() dto: CreateWorkItemDto,
  ) {
    // The referral/source drives profit-share → only an admin may set it. A writer
    // logs the job (course + their fee); the admin assigns the referral later.
    if (!canSeeMoney(principal, perms)) dto.sourcePartyId = undefined;
    return this.db.withTenant(ctx, (tx) => this.work.create(tx, principal, dto));
  }

  /** "Add course / thesis / project" — one parent + N priced parts in one entry. */
  @Post("bundle")
  @RequirePermission("work", "create")
  createBundle(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreateBundleDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.work.createBundle(tx, principal, dto));
  }

  @Get()
  @RequirePermission("work", "view")
  list(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Query() query: ListWorkQueryDto,
  ) {
    return this.db.withTenant(ctx, (tx) =>
      this.work.list(
        tx,
        {
          doerPartyId: query.doerPartyId,
          sourcePartyId: query.sourcePartyId,
          clientPartyId: query.clientPartyId,
          workState: query.workState,
          includeArchived: query.includeArchived === "true",
          q: query.q,
        },
        canSeeMoney(principal, perms),
        principal.isSystemSuperadmin,
      ),
    );
  }

  /** Job-detail hub: spec + lines (money redacted per caller) + visible legs + margins. */
  @Get(":id")
  @RequirePermission("work", "view")
  getById(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) =>
      this.work.getDetail(tx, id, canSeeMoney(principal, perms)),
    );
  }

  /** Possible duplicate/overlap work items (capture-first heuristic; never blocks). */
  @Get(":id/possible-duplicates")
  @RequirePermission("work", "view")
  possibleDuplicates(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const item = await this.work.getRaw(tx, id);
      return this.work.possibleDuplicates(tx, {
        id: item.id,
        sourcePartyId: item.sourcePartyId,
        courseRefId: item.courseRefId,
        assignmentTypeRefId: item.assignmentTypeRefId,
        title: item.title,
      });
    });
  }

  @Patch(":id")
  @RequirePermission("work", "edit")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkItemDto,
  ) {
    // Referral/source is admin-only (drives profit-share). A non-admin edit leaves it untouched.
    if (!canSeeMoney(principal, perms)) dto.sourcePartyId = undefined;
    return this.db.withTenant(ctx, (tx) => this.work.update(tx, principal, id, dto));
  }

  /** Soft-delete (archive) a job — hides it from the board; legs/money stay intact. */
  @Post(":id/archive")
  @RequirePermission("work", "approve")
  archive(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.work.archive(tx, principal, id));
  }

  /**
   * Hand a job to another admin (0051). Owner keeps a %; a commission leg is
   * posted and the job + client are SHARED with the receiver. Money-affecting +
   * append-only → work:approve.
   */
  @Post(":id/handoff")
  @RequirePermission("work", "approve")
  handoff(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: HandoffDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.work.handoff(tx, principal, id, dto));
  }

  /** Who this job is shared with (owner/SuperAdmin only; via the owner-gated definer). */
  @Get(":id/shares")
  @RequirePermission("work", "approve")
  listShares(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.work.listShares(tx, id));
  }

  /** Share a job (visibility only, no money) with another admin. */
  @Post(":id/share")
  @RequirePermission("work", "approve")
  share(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ShareDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.work.shareJob(tx, principal, id, dto.granteePartyId));
  }

  /** Stop sharing a job with an admin (revokes the job + client grant). */
  @Post(":id/unshare")
  @RequirePermission("work", "approve")
  unshare(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ShareDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.work.unshareJob(tx, principal, id, dto.granteePartyId));
  }

  /** Work-state machine; →confirmed additionally requires work:approve. */
  @Post(":id/transition")
  @RequirePermission("work", "edit")
  transition(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto,
  ) {
    return this.db.withTenant(ctx, (tx) =>
      this.work.transition(tx, principal, id, dto.toState, canSeeMoney(principal, perms)),
    );
  }

  @Post(":id/lines")
  @RequirePermission("work", "create")
  addLine(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddLineDto,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.lines.addLine(tx, principal, id, dto);
      // Redact money/consumer identity in the response per the caller (B2).
      return this.lines.mapLine(row, canSeeMoney(principal, perms));
    });
  }

  /**
   * Move a single line through its lifecycle (0048, Phase 4A): draft→pending→
   * submitted, or →cancelled from pending/submitted. `billed` is set by invoicing,
   * never here; a billed line is frozen (correct its amount via reprice).
   */
  /**
   * Inline-edit a line's fields (the grid's pre-bill cell edit). Billed lines are
   * rejected (→ reprice); the client price is applied only for an admin.
   */
  @Patch("lines/:lineId")
  @RequirePermission("work", "edit")
  updateLine(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("lineId", ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateLineDto,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.lines.updateLine(tx, principal, lineId, dto, canSeeMoney(principal, perms));
      return this.lines.mapLine(row, canSeeMoney(principal, perms));
    });
  }

  @Post("lines/:lineId/status")
  @HttpCode(200)
  @RequirePermission("work", "edit")
  setLineStatus(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("lineId", ParseUUIDPipe) lineId: string,
    @Body() dto: SetLineStatusDto,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.lines.setLineStatus(tx, principal, lineId, dto.to);
      return this.lines.mapLine(row, canSeeMoney(principal, perms));
    });
  }

  /** Copy fan-out: one producer entry → N independent consumer lines. */
  @Post(":id/fan-out")
  @RequirePermission("work", "create")
  fanOut(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: FanOutDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.lines.fanOutCopies(tx, principal, id, dto));
  }

  /** Build/append the money chain (sensitive → approve). Append-only. */
  @Post(":id/legs")
  @RequirePermission("work", "approve")
  appendLegs(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AppendLegsDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.legs.appendLegs(tx, principal, id, dto));
  }

  /**
   * Capture-first: propose leg prices from the resolved deal terms WITHOUT
   * writing, so the add-a-job flow can show (and let the builder override)
   * rule-derived amounts before committing. Same gate as appendLegs.
   */
  @Post(":id/legs/propose")
  @HttpCode(200) // read-only: proposes prices, writes nothing
  @RequirePermission("work", "approve")
  proposeLegs(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AppendLegsDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.legs.proposeLegs(tx, principal, id, dto));
  }

  /**
   * Resit a failed job (§3/§6/§8): reopen (work-state redo) + the resit writer's
   * line/leg + the original writer's reduction (auto reversing-leg vs clawback
   * charge) + optional client re-bill to 0. Money-affecting → approve. Returns
   * the derived job P&L (the truthful net loss). Append-only throughout.
   */
  @Post(":id/resit")
  @RequirePermission("work", "approve")
  resit(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResitDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.resits.resit(tx, principal, id, dto));
  }

  /**
   * Re-price a from→to leg pair to a new total (P1 item 6). Append-only: posts a
   * single delta leg (new − current) via the caller-guarded leg_pair_sum definer.
   * Money-affecting → work:approve.
   */
  @Post(":id/legs/reprice")
  @HttpCode(200)
  @RequirePermission("work", "approve")
  reprice(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RepriceLegDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.legs.repriceLeg(tx, principal, id, dto));
  }

  /** Visible legs (RLS-filtered to the caller) + derived margins. */
  @Get(":id/legs")
  @RequirePermission("work", "view")
  async getLegs(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const legs = await this.legs.getVisibleLegs(tx, id);
      return { legs, margins: this.legs.marginsFor(legs) };
    });
  }
}
