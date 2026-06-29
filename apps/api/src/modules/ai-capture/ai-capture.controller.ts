import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { CaptureService } from "./capture.service.js";
import { ProposalService } from "./proposal.service.js";
import { CaptureDto, EditProposalDto } from "./dto.js";

/**
 * AI capture assistant (§10/§2). Extraction PROPOSES drafts (writes only
 * ai_proposal rows); a human Accept creates the real record through the existing
 * services (stamped "added by AI"). All endpoints require ai_capture:create;
 * Accept additionally enforces the target's create permission in-service.
 */
@Controller("ai-capture")
export class AiCaptureController {
  constructor(
    private readonly db: DbService,
    private readonly capture: CaptureService,
    private readonly proposals: ProposalService,
  ) {}

  @Post()
  @RequirePermission("ai_capture", "create")
  extract(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CaptureDto) {
    return this.db.withTenant(ctx, (tx) => this.capture.capture(tx, p, dto));
  }

  @Get()
  @RequirePermission("ai_capture", "view")
  list(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.capture.listRecent(tx));
  }

  @Get(":id")
  @RequirePermission("ai_capture", "view")
  getById(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.capture.getById(tx, id));
  }

  @Post("proposals/:id/edit")
  @RequirePermission("ai_capture", "create")
  edit(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: EditProposalDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.proposals.edit(tx, p, id, dto.fields));
  }

  @Post("proposals/:id/accept")
  @RequirePermission("ai_capture", "create")
  accept(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.proposals.accept(tx, p, perms, id));
  }

  @Post("proposals/:id/reject")
  @RequirePermission("ai_capture", "create")
  reject(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.proposals.reject(tx, p, id));
  }
}
