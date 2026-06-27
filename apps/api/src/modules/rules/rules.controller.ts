import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import {
  CreateCompRuleDto,
  CreateDealTermDto,
  ListCompRulesQueryDto,
  ListDealTermsQueryDto,
  PreviewLegsQueryDto,
  ResolveCompRuleQueryDto,
  ResolveDealTermQueryDto,
  SupersedeCompRuleDto,
  SupersedeDealTermDto,
} from "./dto.js";
import { RulesService } from "./rules.service.js";

/** Module 3 — effective-dated rules engine. All endpoints gated by `rules:*`. */
@Controller()
export class RulesController {
  constructor(
    private readonly db: DbService,
    private readonly rules: RulesService,
  ) {}

  // ── deal terms ──
  @Post("deal-terms")
  @RequirePermission("rules", "create")
  createDealTerm(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreateDealTermDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.rules.createDealTerm(tx, principal, dto));
  }

  @Post("deal-terms/supersede")
  @RequirePermission("rules", "edit")
  supersedeDealTerm(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: SupersedeDealTermDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.rules.supersedeDealTerm(tx, principal, dto));
  }

  @Get("deal-terms")
  @RequirePermission("rules", "view")
  listDealTerms(@CurrentRls() ctx: RlsContext, @Query() q: ListDealTermsQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.rules.listDealTerms(tx, q));
  }

  @Get("deal-terms/resolve")
  @RequirePermission("rules", "view")
  resolveDealTerm(@CurrentRls() ctx: RlsContext, @Query() q: ResolveDealTermQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.rules.resolveDealTerm(tx, q));
  }

  // ── comp rules ──
  @Post("comp-rules")
  @RequirePermission("rules", "create")
  createCompRule(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreateCompRuleDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.rules.createCompRule(tx, principal, dto));
  }

  @Post("comp-rules/supersede")
  @RequirePermission("rules", "edit")
  supersedeCompRule(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: SupersedeCompRuleDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.rules.supersedeCompRule(tx, principal, dto));
  }

  @Get("comp-rules")
  @RequirePermission("rules", "view")
  listCompRules(@CurrentRls() ctx: RlsContext, @Query() q: ListCompRulesQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.rules.listCompRules(tx, q));
  }

  @Get("comp-rules/resolve")
  @RequirePermission("rules", "view")
  resolveCompRule(@CurrentRls() ctx: RlsContext, @Query() q: ResolveCompRuleQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.rules.resolveCompRule(tx, q));
  }

  // ── preview (read-only) ──
  @Get("rules/preview-legs/:workItemId")
  @RequirePermission("rules", "view")
  previewLegs(
    @CurrentRls() ctx: RlsContext,
    @Param("workItemId", ParseUUIDPipe) workItemId: string,
    @Query() q: PreviewLegsQueryDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.rules.previewLegs(tx, workItemId, q.asOf));
  }
}
