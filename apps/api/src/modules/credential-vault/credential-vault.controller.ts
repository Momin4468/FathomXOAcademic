import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { CreateCredentialDto, GrantShareDto, ListVaultQueryDto, RevealDto, UpdateCredentialDto } from "./dto.js";
import { CredentialVaultService } from "./credential-vault.service.js";

/**
 * Module 8 — credential vault (§8). Reads/reveals are gated credential_vault:view
 * (RLS scopes to the caller's shared items); management (list-all, grant, revoke)
 * is gated credential_vault:approve and goes through the SECURITY DEFINER path.
 */
@Controller("vault")
export class CredentialVaultController {
  constructor(
    private readonly db: DbService,
    private readonly vault: CredentialVaultService,
  ) {}

  @Get("items")
  @RequirePermission("credential_vault", "view")
  listMine(@CurrentRls() ctx: RlsContext, @Query() q: ListVaultQueryDto) {
    return this.db.withTenant(ctx, (tx) => this.vault.listMine(tx, q.clientPartyId));
  }

  @Post("items")
  @RequirePermission("credential_vault", "create")
  create(@CurrentRls() ctx: RlsContext, @CurrentPrincipal() p: SessionPrincipal, @Body() dto: CreateCredentialDto) {
    return this.db.withTenant(ctx, (tx) => this.vault.createItem(tx, p, dto));
  }

  @Patch("items/:id")
  @RequirePermission("credential_vault", "edit")
  edit(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCredentialDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.vault.editItem(tx, p, id, dto));
  }

  /** Decrypt + return the secret — holder-only (RLS) + mandatory TOTP step-up. */
  @Post("items/:id/reveal")
  @HttpCode(200) // a read action (returns the secret); creates nothing
  @RequirePermission("credential_vault", "view")
  reveal(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RevealDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.vault.reveal(tx, p, id, dto));
  }

  // ── manager path ──
  @Get("manage/items")
  @RequirePermission("credential_vault", "approve")
  manageList(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.vault.manageList(tx));
  }

  @Get("items/:id/shares")
  @RequirePermission("credential_vault", "approve")
  shares(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.vault.manageShares(tx, id));
  }

  @Post("items/:id/shares")
  @RequirePermission("credential_vault", "approve")
  grant(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GrantShareDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.vault.grant(tx, p, id, dto));
  }

  @Post("shares/:id/revoke")
  @RequirePermission("credential_vault", "approve")
  revoke(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() p: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.vault.revoke(tx, p, id));
  }
}
