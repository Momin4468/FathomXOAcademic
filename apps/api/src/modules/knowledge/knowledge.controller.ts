import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import {
  AttachDto,
  CreateArticleDto,
  CreateCoverSheetDto,
  ListArticlesQueryDto,
  ListCoverSheetsQueryDto,
  UpdateArticleDto,
  UpdateCoverSheetDto,
} from "./dto.js";
import { KnowledgeService } from "./knowledge.service.js";

/**
 * Module 9 — knowledge base + cover sheets (§7/§8). Reads are knowledge:view
 * (all roles); article authoring is knowledge:create (open authoring); cover-
 * sheet writes + curating others' articles need knowledge:approve.
 */
@Controller("knowledge")
export class KnowledgeController {
  constructor(
    private readonly db: DbService,
    private readonly kb: KnowledgeService,
  ) {}

  // ── articles ──
  @Get("articles")
  @RequirePermission("knowledge", "view")
  listArticles(@CurrentRls() ctx: RlsContext, @Query() q: ListArticlesQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.kb.listArticles(tx, q));
  }

  @Post("articles")
  @RequirePermission("knowledge", "create")
  createArticle(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateArticleDto) {
    return this.db.withTenant(ctx, (tx) => this.kb.createArticle(tx, p, dto));
  }

  @Get("articles/:id")
  @RequirePermission("knowledge", "view")
  getArticle(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.kb.getArticle(tx, id));
  }

  @Patch("articles/:id")
  @RequirePermission("knowledge", "create")
  updateArticle(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.kb.updateArticle(tx, p, perms, id, dto));
  }

  @Delete("articles/:id")
  @RequirePermission("knowledge", "create")
  archiveArticle(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.kb.archiveArticle(tx, p, perms, id));
  }

  @Post("articles/:id/attachments")
  @RequirePermission("knowledge", "create")
  attach(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AttachDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.kb.attach(tx, p, perms, id, dto));
  }

  @Delete("articles/:id/attachments/:fileId")
  @RequirePermission("knowledge", "create")
  detach(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.kb.detach(tx, p, perms, id, fileId));
  }

  // ── cover sheets ──
  @Get("cover-sheets")
  @RequirePermission("knowledge", "view")
  listCoverSheets(@CurrentRls() ctx: RlsContext, @Query() q: ListCoverSheetsQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.kb.listCoverSheets(tx, q));
  }

  @Post("cover-sheets")
  @RequirePermission("knowledge", "approve")
  createCoverSheet(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateCoverSheetDto) {
    return this.db.withTenant(ctx, (tx) => this.kb.createCoverSheet(tx, p, dto));
  }

  @Patch("cover-sheets/:id")
  @RequirePermission("knowledge", "approve")
  updateCoverSheet(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoverSheetDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.kb.updateCoverSheet(tx, p, id, dto));
  }

  // ── university hub ──
  @Get("university/:refId")
  @RequirePermission("knowledge", "view")
  universityHub(@CurrentRls() ctx: RlsContext, @Param("refId", ParseUUIDPipe) refId: string) {
    return this.db.withTenant(ctx, (tx) => this.kb.getUniversityHub(tx, refId));
  }
}
