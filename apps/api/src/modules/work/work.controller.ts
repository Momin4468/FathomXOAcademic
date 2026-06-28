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
  CreateWorkItemDto,
  FanOutDto,
  ListWorkQueryDto,
  ResitDto,
  TransitionDto,
  UpdateWorkItemDto,
} from "./dto.js";
import { LegService } from "./leg.service.js";
import { LineService } from "./line.service.js";
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
  ) {}

  @Post()
  @RequirePermission("work", "create")
  create(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreateWorkItemDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.work.create(tx, principal, dto));
  }

  @Get()
  @RequirePermission("work", "view")
  list(@CurrentRls() ctx: RlsContext, @Query() query: ListWorkQueryDto) {
    return this.db.withTenant(ctx, (tx) =>
      this.work.list(tx, {
        doerPartyId: query.doerPartyId,
        sourcePartyId: query.sourcePartyId,
        workState: query.workState,
        includeArchived: query.includeArchived === "true",
      }),
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

  @Patch(":id")
  @RequirePermission("work", "edit")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkItemDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.work.update(tx, principal, id, dto));
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
