import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import {
  AddCheckFileDto,
  CreateChannelDto,
  CreateToolAccountDto,
  ListBatchesQueryDto,
  PnlQueryDto,
  RecordBatchDto,
  TopupDto,
  UpdateBatchDto,
  UpdateChannelDto,
} from "./dto.js";
import { ChecksService } from "./checks.service.js";

/**
 * Module 10 — the AI/plagiarism check service (§8). Workers (checks:create)
 * record batches on their own channels; admins (checks:approve) confirm tallies,
 * manage tool accounts / top-ups, and read the unit P&L.
 */
@Controller("checks")
export class ChecksController {
  constructor(
    private readonly db: DbService,
    private readonly checks: ChecksService,
  ) {}

  // ── channels ──
  @Get("channels")
  @RequirePermission("checks", "view")
  listChannels(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions) {
    return this.db.withTenant(ctx, (tx) => this.checks.listChannels(tx, p, perms));
  }

  @Post("channels")
  @RequirePermission("checks", "create")
  createChannel(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions, @Body() dto: CreateChannelDto) {
    return this.db.withTenant(ctx, (tx) => this.checks.createChannel(tx, p, perms, dto));
  }

  @Patch("channels/:id")
  @RequirePermission("checks", "create")
  updateChannel(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateChannelDto) {
    return this.db.withTenant(ctx, (tx) => this.checks.updateChannel(tx, p, perms, id, dto));
  }

  // ── tool accounts + top-ups ──
  @Get("tool-accounts")
  @RequirePermission("checks", "view")
  listToolAccounts(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions) {
    const includeCredit = p.isSystemSuperadmin || perms.perms.has("checks:approve");
    return this.db.withTenant(ctx, (tx) => this.checks.listToolAccounts(tx, includeCredit));
  }

  @Post("tool-accounts")
  @RequirePermission("checks", "approve")
  createToolAccount(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateToolAccountDto) {
    return this.db.withTenant(ctx, (tx) => this.checks.createToolAccount(tx, p, dto));
  }

  @Post("tool-accounts/:id/topups")
  @RequirePermission("checks", "approve")
  topup(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string, @Body() dto: TopupDto) {
    return this.db.withTenant(ctx, (tx) => this.checks.topup(tx, p, id, dto));
  }

  // ── batches ──
  @Get("batches")
  @RequirePermission("checks", "view")
  listBatches(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions, @Query() q: ListBatchesQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.checks.listBatches(tx, p, perms, q));
  }

  @Post("batches")
  @RequirePermission("checks", "create")
  recordBatch(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions, @Body() dto: RecordBatchDto) {
    return this.db.withTenant(ctx, (tx) => this.checks.recordBatch(tx, p, perms, dto));
  }

  @Get("batches/:id")
  @RequirePermission("checks", "view")
  getBatch(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.checks.getBatch(tx, p, perms, id));
  }

  @Patch("batches/:id")
  @RequirePermission("checks", "create")
  updateBatch(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBatchDto) {
    return this.db.withTenant(ctx, (tx) => this.checks.updateBatch(tx, p, perms, id, dto));
  }

  /** Governance: confirm a claimed tally — approver only, never the recorder. */
  @Post("batches/:id/confirm")
  @RequirePermission("checks", "approve")
  confirmBatch(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.checks.confirmBatch(tx, p, id));
  }

  // ── per-file detail ──
  @Post("batches/:id/files")
  @RequirePermission("checks", "create")
  addFile(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AddCheckFileDto) {
    return this.db.withTenant(ctx, (tx) => this.checks.addCheckFile(tx, p, perms, id, dto));
  }

  @Get("batches/:id/files")
  @RequirePermission("checks", "view")
  listFiles(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.checks.listCheckFiles(tx, p, perms, id));
  }

  @Delete("files/:id")
  @RequirePermission("checks", "create")
  removeFile(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @CurrentPermissions() perms: EffectivePermissions, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.checks.removeCheckFile(tx, p, perms, id));
  }

  // ── P&L (admin) ──
  @Get("pnl")
  @RequirePermission("checks", "approve")
  pnl(@CurrentRls() ctx: RlsContext, @Query() q: PnlQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.checks.getPnl(tx, q));
  }
}
