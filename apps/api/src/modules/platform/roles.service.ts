import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { SYSTEM_SUPERADMIN_ROLE, type SessionPrincipal } from "@business-os/shared";
import { and, count, eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { EffectivePermissions } from "../../common/authz/permission.service.js";
import { PermissionCatalogService } from "./permission-catalog.service.js";
import type { CreateRoleDto, TogglePermissionDto, UpdateRoleDto } from "./dto.js";

const { role, permission, userRole, userAccount, party } = schema;

/**
 * The RBAC MANAGEMENT layer (roles/permissions admin). Read side of the engine
 * lives in PermissionService; this is the write side, gated to the `platform`
 * module (SuperAdmin-only by seed) and audited. All mutations run inside the
 * caller's tenant transaction, so RLS scopes every row to the active org.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly audit: AuditService,
    private readonly catalog: PermissionCatalogService,
  ) {}

  /** List roles with derived permission + assignment counts. */
  async list(tx: Db) {
    const roles = await tx
      .select({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
      })
      .from(role);
    const permCounts = await tx
      .select({ roleId: permission.roleId, n: count() })
      .from(permission)
      .groupBy(permission.roleId);
    const asgCounts = await tx
      .select({ roleId: userRole.roleId, n: count() })
      .from(userRole)
      .groupBy(userRole.roleId);
    const permMap = new Map(permCounts.map((r) => [r.roleId, Number(r.n)]));
    const asgMap = new Map(asgCounts.map((r) => [r.roleId, Number(r.n)]));
    return roles
      .map((r) => ({
        ...r,
        permissionCount: permMap.get(r.id) ?? 0,
        assignmentCount: asgMap.get(r.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** One role + its granted permissions + who holds it. */
  async detail(tx: Db, id: string) {
    const r = await this.getRole(tx, id);
    const permissions = await tx
      .select({ module: permission.module, action: permission.action })
      .from(permission)
      .where(eq(permission.roleId, id));
    const assignments = await tx
      .select({
        userId: userRole.userId,
        email: userAccount.email,
        displayName: party.displayName,
      })
      .from(userRole)
      .innerJoin(userAccount, eq(userAccount.id, userRole.userId))
      .leftJoin(party, eq(party.id, userAccount.partyId))
      .where(eq(userRole.roleId, id));
    return { ...r, permissions, assignments };
  }

  /** Users (for the assignment picker) with the roles they already hold. */
  async listUsers(tx: Db) {
    const users = await tx
      .select({
        id: userAccount.id,
        email: userAccount.email,
        displayName: party.displayName,
      })
      .from(userAccount)
      .leftJoin(party, eq(party.id, userAccount.partyId));
    const roleRows = await tx
      .select({ userId: userRole.userId, name: role.name })
      .from(userRole)
      .innerJoin(role, eq(role.id, userRole.roleId));
    const byUser = new Map<string, string[]>();
    for (const row of roleRows) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row.name);
      byUser.set(row.userId, list);
    }
    return users
      .map((u) => ({ ...u, roleNames: (byUser.get(u.id) ?? []).sort() }))
      .sort((a, b) => (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email));
  }

  async create(tx: Db, principal: SessionPrincipal, dto: CreateRoleDto) {
    const [row] = await tx
      .insert(role)
      .values({
        orgId: principal.orgId,
        name: dto.name,
        description: dto.description ?? null,
        isSystem: false,
      })
      .returning({ id: role.id, name: role.name, description: role.description, isSystem: role.isSystem });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "platform.role_created",
      entity: "role",
      entityId: row!.id,
      detail: { name: dto.name },
    });
    return row;
  }

  async update(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateRoleDto) {
    const r = await this.getRole(tx, id);
    this.assertMutable(r);
    if (dto.name !== undefined && dto.name !== r.name && r.isSystem) {
      throw new BadRequestException("Built-in roles can't be renamed");
    }
    const patch: Partial<{ name: string; description: string | null }> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (Object.keys(patch).length === 0) return r;
    const [row] = await tx
      .update(role)
      .set(patch)
      .where(eq(role.id, id))
      .returning({ id: role.id, name: role.name, description: role.description, isSystem: role.isSystem });
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "platform.role_updated",
      entity: "role",
      entityId: id,
      detail: patch,
    });
    return row;
  }

  async remove(tx: Db, principal: SessionPrincipal, id: string) {
    const r = await this.getRole(tx, id);
    this.assertMutable(r);
    if (r.isSystem) throw new BadRequestException("Built-in roles can't be deleted");
    const [asg] = await tx.select({ n: count() }).from(userRole).where(eq(userRole.roleId, id));
    if (Number(asg?.n ?? 0) > 0) {
      throw new BadRequestException("Unassign this role from all users before deleting it");
    }
    await tx.delete(permission).where(eq(permission.roleId, id));
    await tx.delete(role).where(eq(role.id, id));
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "platform.role_deleted",
      entity: "role",
      entityId: id,
      detail: { name: r.name },
    });
    return { ok: true };
  }

  /** Grant or revoke a single module × action on a role (idempotent). */
  async togglePermission(
    tx: Db,
    principal: SessionPrincipal,
    perms: EffectivePermissions,
    id: string,
    dto: TogglePermissionDto,
  ) {
    const r = await this.getRole(tx, id);
    this.assertMutable(r);
    const permKey = `${dto.module}:${dto.action}`;

    if (dto.granted) {
      // Strict: never grant a permission that no endpoint enforces (keeps the
      // stored grants meaningful; the UI already hides these cells).
      if (!this.catalog.isEnforced(dto.module, dto.action)) {
        throw new BadRequestException(`No endpoint enforces ${permKey} yet — it can't be granted`);
      }
      // No self-escalation: a non-SuperAdmin can't add, to a role they themselves
      // hold, a permission they don't already have (spec §4 / CLAUDE.md §4).
      if (!principal.isSystemSuperadmin) {
        const holdsRole = await this.userHoldsRole(tx, principal.userId, id);
        if (holdsRole && !perms.perms.has(permKey)) {
          throw new ForbiddenException(
            `You can't grant ${permKey} to a role you hold — you don't have it yourself`,
          );
        }
      }
      await tx
        .insert(permission)
        .values({ orgId: principal.orgId, roleId: id, module: dto.module, action: dto.action })
        .onConflictDoNothing();
      await this.audit.record(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "platform.permission_granted",
        entity: "role",
        entityId: id,
        detail: { module: dto.module, action: dto.action },
      });
    } else {
      await tx
        .delete(permission)
        .where(
          and(
            eq(permission.roleId, id),
            eq(permission.module, dto.module),
            eq(permission.action, dto.action),
          ),
        );
      await this.audit.record(tx, principal.orgId, {
        actorUserId: principal.userId,
        action: "platform.permission_revoked",
        entity: "role",
        entityId: id,
        detail: { module: dto.module, action: dto.action },
      });
    }
    return { ok: true, granted: dto.granted };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async getRole(tx: Db, id: string) {
    const [r] = await tx
      .select({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
      })
      .from(role)
      .where(eq(role.id, id));
    if (!r) throw new NotFoundException("Role not found");
    return r;
  }

  /** The System SuperAdmin role is the break-glass path — fully immutable. */
  private assertMutable(r: { name: string }) {
    if (r.name === SYSTEM_SUPERADMIN_ROLE) {
      throw new ForbiddenException("The System SuperAdmin role is immutable");
    }
  }

  private async userHoldsRole(tx: Db, userId: string, roleId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: userRole.id })
      .from(userRole)
      .where(and(eq(userRole.userId, userId), eq(userRole.roleId, roleId)))
      .limit(1);
    return !!row;
  }
}
