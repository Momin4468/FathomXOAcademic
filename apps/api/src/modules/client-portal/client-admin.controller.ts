import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { ClientAdminService } from "./client-admin.service.js";
import { AdminReplyDto, AutoProvisionDto, ProvisionAccountDto, UpdateAccountDto } from "./dto.js";

/**
 * Admin-side client-portal management (Module 18), on the BUSINESS plane and
 * gated by the `client_portal` permission. Provision logins for existing client
 * parties, read/reply message threads, purge expired leads. Client-submitted
 * drafts surface in the existing work list (work_state=draft + client_account_id).
 */
@Controller("client-portal")
export class ClientAdminController {
  constructor(
    private readonly db: DbService,
    private readonly admin: ClientAdminService,
  ) {}

  @Get("accounts")
  @RequirePermission("client_portal", "view")
  listAccounts(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.admin.listAccounts(tx));
  }

  @Post("accounts")
  @RequirePermission("client_portal", "create")
  provision(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: ProvisionAccountDto) {
    return this.db.withTenant(ctx, (tx) => this.admin.provisionAccount(tx, p, dto));
  }

  /** Auto-provision a login from a student id + name (item 8); returns the derived initial creds. */
  @Post("accounts/auto")
  @RequirePermission("client_portal", "create")
  autoProvision(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: AutoProvisionDto) {
    return this.db.withTenant(ctx, (tx) => this.admin.autoProvisionAccount(tx, p, dto));
  }

  @Patch("accounts/:id")
  @RequirePermission("client_portal", "edit")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.admin.updateAccount(tx, p, id, dto));
  }

  @Get("messages")
  @RequirePermission("client_portal", "view")
  listMessages(@CurrentRls() ctx: RlsContext, @Query("partyId", ParseUUIDPipe) partyId: string) {
    return this.db.withTenant(ctx, (tx) => this.admin.listMessages(tx, partyId));
  }

  @Post("messages")
  @RequirePermission("client_portal", "create")
  reply(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: AdminReplyDto) {
    return this.db.withTenant(ctx, (tx) => this.admin.reply(tx, p, dto));
  }

  @Post("leads/purge")
  @HttpCode(200)
  @RequirePermission("client_portal", "approve")
  purge(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.admin.purge(tx));
  }
}
