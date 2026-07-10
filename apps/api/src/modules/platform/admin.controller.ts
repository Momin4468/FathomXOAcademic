import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { schema } from "@business-os/db";
import type { RlsContext, SessionPrincipal } from "@business-os/shared";
import { and, eq, isNull } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { PasswordService } from "../../common/auth/password.service.js";
import { CurrentPrincipal } from "../../common/auth/current-principal.decorator.js";
import { CurrentPermissions } from "../../common/authz/current-permissions.decorator.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { RequirePermission } from "../../common/authz/require-permission.decorator.js";
import { DbService } from "../../common/db/db.service.js";
import { CurrentRls } from "../../common/rls/rls-context.js";
import { AssignRoleDto, CreateUserDto, SetUserStatusDto } from "./dto.js";

/**
 * Minimal platform admin surface (Module 0). Every endpoint is permission-gated
 * (roles-as-data) and audited. Restricted to the `platform` module, which only
 * System SuperAdmin holds create/approve on by seed — Admins (Momin/Emon) do not
 * (no self-promotion; spec §10).
 */
@Controller("platform")
export class AdminController {
  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  /** Create a login (optionally linked to a party — never merged). */
  @Post("users")
  @RequirePermission("platform", "create")
  async createUser(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() dto: CreateUserDto,
  ) {
    const hash = await this.passwords.hash(dto.password);
    return this.db.withTenant(ctx, async (tx) => {
      const [user] = await tx
        .insert(schema.userAccount)
        .values({
          orgId: ctx.orgId,
          email: dto.email,
          passwordHash: hash,
          partyId: dto.partyId ?? null,
        })
        .returning({ id: schema.userAccount.id, email: schema.userAccount.email });
      await this.audit.record(tx, ctx.orgId, {
        actorUserId: principal.userId,
        action: "platform.user_created",
        entity: "user_account",
        entityId: user!.id,
        detail: { email: dto.email, linkedParty: dto.partyId ?? null },
      });
      return user;
    });
  }

  /**
   * Enable/disable a login. A disabled account fails auth at `login()` (status
   * check) but is NEVER deleted — it stays referenced by the audit/ledger trail.
   * You cannot disable your own account (no self-lockout).
   */
  @Patch("users/:id/status")
  @RequirePermission("platform", "approve")
  async setUserStatus(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) userId: string,
    @Body() dto: SetUserStatusDto,
  ) {
    if (userId === principal.userId && dto.status !== "active") {
      throw new BadRequestException("You cannot disable your own account.");
    }
    return this.db.withTenant(ctx, async (tx) => {
      const [row] = await tx
        .update(schema.userAccount)
        .set({ status: dto.status, updatedAt: new Date() })
        .where(eq(schema.userAccount.id, userId))
        .returning({ id: schema.userAccount.id, status: schema.userAccount.status });
      if (!row) throw new BadRequestException("User not found.");
      // Disabling revokes outstanding refresh tokens so open sessions can't refresh.
      if (dto.status !== "active") {
        await tx
          .update(schema.authRefreshToken)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.authRefreshToken.userId, userId),
              isNull(schema.authRefreshToken.revokedAt),
            ),
          );
      }
      await this.audit.record(tx, ctx.orgId, {
        actorUserId: principal.userId,
        action: "platform.user_status_changed",
        entity: "user_account",
        entityId: userId,
        detail: { status: dto.status },
      });
      return { ok: true, status: row.status };
    });
  }

  /** Assign a role to a user (multi-hat). */
  @Post("users/:id/roles")
  @RequirePermission("platform", "approve")
  async assignRole(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) userId: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      const [row] = await tx
        .insert(schema.userRole)
        .values({ orgId: ctx.orgId, userId, roleId: dto.roleId })
        .returning({ id: schema.userRole.id });
      await this.audit.record(tx, ctx.orgId, {
        actorUserId: principal.userId,
        action: "platform.role_assigned",
        entity: "user_role",
        entityId: row!.id,
        detail: { userId, roleId: dto.roleId },
      });
      return { ok: true, id: row!.id };
    });
  }

  /** Revoke a role from a user. */
  @Delete("users/:id/roles/:roleId")
  @RequirePermission("platform", "approve")
  async revokeRole(
    @CurrentRls() ctx: RlsContext,
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param("id", ParseUUIDPipe) userId: string,
    @Param("roleId", ParseUUIDPipe) roleId: string,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      const deleted = await tx
        .delete(schema.userRole)
        .where(and(eq(schema.userRole.userId, userId), eq(schema.userRole.roleId, roleId)))
        .returning({ id: schema.userRole.id });
      await this.audit.record(tx, ctx.orgId, {
        actorUserId: principal.userId,
        action: "platform.role_revoked",
        entity: "user_role",
        entityId: deleted[0]?.id ?? null,
        detail: { userId, roleId },
      });
      return { ok: true, revoked: deleted.length };
    });
  }

  /** The caller's own effective permissions (loaded by PermissionGuard). */
  @Get("permissions/me")
  @RequirePermission("platform", "view")
  myPermissions(@CurrentPermissions() perms: EffectivePermissions) {
    return {
      roleNames: perms.roleNames,
      permissions: [...perms.perms].sort(),
    };
  }
}
