import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { ConvertLogDto, LogWorkDto } from "./dto.js";
import { HrmService } from "./hrm.service.js";

/**
 * Module 22 — HRM employee work-logging (audit item 12). Employees log work
 * (hrm:create) and see their OWN logs (hrm:view, self-scoped) with NO money;
 * admins review + convert/reject (hrm:approve). Business plane — no separate login.
 * Gated FEATURE_HRM.
 */
@Controller("worklog")
export class HrmController {
  constructor(
    private readonly db: DbService,
    private readonly hrm: HrmService,
  ) {}

  @Post()
  @RequirePermission("hrm", "create")
  log(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: LogWorkDto) {
    return this.db.withTenant(ctx, (tx) => this.hrm.logWork(tx, p, dto));
  }

  @Get("mine")
  @RequirePermission("hrm", "view")
  mine(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.hrm.myLogs(tx, p));
  }

  /** Admin review queue (all logs, optionally by status). */
  @Get()
  @RequirePermission("hrm", "approve")
  list(@CurrentRls() ctx: RlsContext, @Query("status") status?: string) {
    return this.db.withTenant(ctx, (tx) => this.hrm.listLogs(tx, status));
  }

  @Post(":id/convert")
  @RequirePermission("hrm", "approve")
  convert(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConvertLogDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.hrm.convert(tx, p, id, dto));
  }

  @Post(":id/reject")
  @RequirePermission("hrm", "approve")
  reject(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.hrm.reject(tx, p, id));
  }
}
