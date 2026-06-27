import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { EffectivePermissions } from "./permission.service.js";

/** The caller's effective permissions, loaded by PermissionGuard. */
export const CurrentPermissions = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): EffectivePermissions => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { permissions?: EffectivePermissions }>();
    if (!req.permissions) throw new Error("No permissions on request (PermissionGuard missing?)");
    return req.permissions;
  },
);
