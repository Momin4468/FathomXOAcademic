import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { CreateRoleDto, TogglePermissionDto, UpdateRoleDto } from "./dto.js";
import { PermissionCatalogService } from "./permission-catalog.service.js";
import { RolesService } from "./roles.service.js";

/**
 * The RBAC admin surface (roles / permissions), part of Module 0. Every endpoint
 * is gated to the `platform` module — which only System SuperAdmin holds by seed
 * (Admins deliberately lack it: no self-promotion, spec §10) — and audited. User↔
 * role ASSIGNMENT lives on AdminController (POST/DELETE /platform/users/:id/roles);
 * this controller owns role CRUD + permission toggling + the catalog/user reads.
 */
@Controller("platform")
export class RolesController {
  constructor(
    private readonly db: DbService,
    private readonly roles: RolesService,
    private readonly catalog: PermissionCatalogService,
  ) {}

  /** The authoritative module × action grid (which pairs are actually enforced). */
  @Get("permission-catalog")
  @RequirePermission("platform", "view")
  permissionCatalog() {
    return this.catalog.build();
  }

  /** Users, with the roles they already hold — the assignment picker's source. */
  @Get("users")
  @RequirePermission("platform", "view")
  listUsers(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.roles.listUsers(tx));
  }

  @Get("roles")
  @RequirePermission("platform", "view")
  list(@CurrentRls() ctx: RlsContext) {
    return this.db.withTenant(ctx, (tx) => this.roles.list(tx));
  }

  @Get("roles/:id")
  @RequirePermission("platform", "view")
  detail(@CurrentRls() ctx: RlsContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.withTenant(ctx, (tx) => this.roles.detail(tx, id));
  }

  @Post("roles")
  @RequirePermission("platform", "create")
  create(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreateRoleDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.roles.create(tx, principal, dto));
  }

  @Patch("roles/:id")
  @RequirePermission("platform", "approve")
  update(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.db.withTenant(ctx, (tx) => this.roles.update(tx, principal, id, dto));
  }

  @Delete("roles/:id")
  @RequirePermission("platform", "approve")
  remove(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.db.withTenant(ctx, (tx) => this.roles.remove(tx, principal, id));
  }

  @Put("roles/:id/permissions")
  @RequirePermission("platform", "approve")
  togglePermission(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @CurrentPermissions() perms: EffectivePermissions,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TogglePermissionDto,
  ) {
    return this.db.withTenant(ctx, (tx) =>
      this.roles.togglePermission(tx, principal, perms, id, dto),
    );
  }
}
