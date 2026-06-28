import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import {
  AttachReferralDto,
  SetClientReferrerDto,
  SetReferrerTermsDto,
  SuggestReferralDto,
} from "./dto.js";
import { ReferrersService } from "./referrers.service.js";

/**
 * Module 11 — Referrers (§4/§8). Admins (referrers:approve) manage referrers +
 * their agreements and attach referral legs; a Referrer login (referrers:view)
 * sees ONLY their own slice via GET /referrers/me (RLS + the referrer_works
 * SECURITY DEFINER enforce "own").
 */
@Controller("referrers")
export class ReferrersController {
  constructor(
    private readonly db: DbService,
    private readonly referrers: ReferrersService,
  ) {}

  /** The referrer self-view — own referral income + the works that generated it. */
  @Get("me")
  @RequirePermission("referrers", "view")
  myReferrals(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal) {
    return this.db.withTenant(ctx, (tx) => this.referrers.myReferrals(tx, p));
  }

  @Get()
  @RequirePermission("referrers", "view")
  list(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.referrers.listReferrers(tx));
  }

  @Get(":id/terms")
  @RequirePermission("referrers", "view")
  listTerms(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.referrers.listReferrerTerms(tx, id));
  }

  @Post(":id/terms")
  @RequirePermission("referrers", "approve")
  setTerms(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetReferrerTermsDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.referrers.setReferrerTerms(tx, p, id, dto));
  }

  @Put("clients/:clientId")
  @RequirePermission("referrers", "approve")
  setClientReferrer(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("clientId", ParseUUIDPipe) clientId: string,
    @Body() dto: SetClientReferrerDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.referrers.setClientReferrer(tx, p, clientId, dto));
  }

  @Post("suggest")
  @HttpCode(200)
  @RequirePermission("referrers", "approve")
  suggest(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Body() dto: SuggestReferralDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.referrers.suggestReferral(tx, p, perms, dto));
  }

  @Post("attach")
  @RequirePermission("referrers", "approve")
  attach(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Body() dto: AttachReferralDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.referrers.attachReferral(tx, p, perms, dto));
  }
}
