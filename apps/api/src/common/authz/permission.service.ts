import { Injectable } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { SYSTEM_SUPERADMIN_ROLE } from "@business-os/shared";
import { eq } from "drizzle-orm";

export interface EffectivePermissions {
  /** Set of "module:action" the user holds (union across roles). */
  perms: Set<string>;
  roleNames: string[];
  /** Raw permission rows incl. scope_json, for per-module row/field scoping. */
  scopes: Array<{ module: string; action: string; scopeJson: unknown }>;
}

const key = (module: string, action: string) => `${module}:${action}`;

/**
 * Roles-as-data permission engine (DESIGN_SPEC §4.3). Resolves a user's effective
 * permissions from user_role → permission (+ role names), scoped to the active
 * org by RLS. Multi-hat: a user may hold several roles; permissions are the union.
 */
@Injectable()
export class PermissionService {
  async loadEffective(tx: Db, userId: string): Promise<EffectivePermissions> {
    const permRows = await tx
      .select({
        module: schema.permission.module,
        action: schema.permission.action,
        scopeJson: schema.permission.scopeJson,
      })
      .from(schema.userRole)
      .innerJoin(schema.permission, eq(schema.permission.roleId, schema.userRole.roleId))
      .where(eq(schema.userRole.userId, userId));

    const roleRows = await tx
      .select({ name: schema.role.name })
      .from(schema.userRole)
      .innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
      .where(eq(schema.userRole.userId, userId));

    return {
      perms: new Set(permRows.map((r) => key(r.module, r.action))),
      roleNames: roleRows.map((r) => r.name),
      scopes: permRows,
    };
  }

  /** Whether a role set includes the technical break-glass role (spec §4.4). */
  isSystemSuperadmin(roleNames: string[]): boolean {
    return roleNames.includes(SYSTEM_SUPERADMIN_ROLE);
  }

  has(perms: Set<string>, module: string, action: string): boolean {
    return perms.has(key(module, action));
  }
}
