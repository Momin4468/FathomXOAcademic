import {
  Body,
  Controller,
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
import { AddAliasDto, MergeRefDto, ResolveRefDto, SearchRefQueryDto, UpdateRefMetaDto } from "./dto.js";
import { ReferenceService } from "./reference.service.js";

/** Canonical reference data + governance (DESIGN_SPEC §7). Routes stay /reference. */
@Controller("reference")
export class ReferenceController {
  constructor(
    private readonly db: DbService,
    private readonly reference: ReferenceService,
  ) {}

  /** Type-ahead search (pick-don't-type). */
  @Get()
  @RequirePermission("reference", "view")
  search(@CurrentRls() ctx: RlsContext, @Query() query: SearchRefQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.reference.search(tx, query.kind, query.q));
  }

  /** The Academic directory: one flat row per course (declared before :id). */
  @Get("academic")
  @RequirePermission("reference", "view")
  academic(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.reference.getAcademic(tx));
  }

  @Get(":id")
  @RequirePermission("reference", "view")
  getById(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.reference.getById(tx, id));
  }

  /** Inline-edit a course's descriptive meta (name / program / referencing). */
  @Patch(":id/meta")
  @RequirePermission("reference", "edit")
  updateMeta(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRefMetaDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.reference.updateMeta(tx, principal, id, dto));
  }

  /** Resolve a typed value to its canonical, or create a provisional (capture-first). */
  @Post("resolve")
  @RequirePermission("reference", "create")
  resolve(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: ResolveRefDto,
  ) {
    return this.db.withTenant(ctx, (tx) =>
      this.reference.resolveOrCreate(tx, principal, {
        kind: dto.kind,
        raw: dto.raw,
        parentId: dto.parentId ?? null,
      }),
    );
  }

  @Post(":id/aliases")
  @RequirePermission("reference", "edit")
  async addAlias(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddAliasDto,
  ) {
    await this.db.withTenant(ctx, (tx) => this.reference.addAlias(tx, principal, id, dto.alias));
    return { ok: true };
  }

  /** Steward: confirm a provisional entity. */
  @Post(":id/confirm")
  @RequirePermission("reference", "approve")
  confirm(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.reference.confirm(tx, principal, id));
  }

  /** Steward: merge a duplicate into a canonical survivor. */
  @Post("merge")
  @RequirePermission("reference", "approve")
  merge(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: MergeRefDto,
  ) {
    return this.db.withTenant(ctx, (tx) =>
      this.reference.merge(tx, principal, dto.sourceId, dto.targetId),
    );
  }
}
