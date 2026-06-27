import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { SessionPrincipal } from "@business-os/shared";
import { DbService } from "../db/db.service.js";
import { extractRlsContext } from "../rls/rls-context.js";
import {
  REQUIRE_PERMISSION_KEY,
  type RequiredPermission,
} from "./require-permission.decorator.js";
import { type EffectivePermissions, PermissionService } from "./permission.service.js";

/**
 * Authorization (runs after AuthGuard). If a handler declares @RequirePermission,
 * load the caller's effective permissions from the DB (roles-as-data) and allow
 * only if they hold module×action — or are System SuperAdmin. Loaded permissions
 * are attached to the request for handlers (@CurrentPermissions).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true; // no permission declared → nothing to enforce here

    const req = context
      .switchToHttp()
      .getRequest<Request & { principal?: SessionPrincipal; permissions?: EffectivePermissions }>();
    if (!req.principal) throw new ForbiddenException("Not authenticated");

    const ctx = extractRlsContext(req);
    const effective = await this.db.withTenant(ctx, (tx) =>
      this.permissions.loadEffective(tx, req.principal!.userId),
    );
    req.permissions = effective;

    const allowed =
      this.permissions.isSystemSuperadmin(effective.roleNames) ||
      this.permissions.has(effective.perms, required.module, required.action);
    if (!allowed) {
      throw new ForbiddenException(
        `Missing permission ${required.module}:${required.action}`,
      );
    }
    return true;
  }
}
