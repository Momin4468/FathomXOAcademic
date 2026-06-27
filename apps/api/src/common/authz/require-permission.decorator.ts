import { SetMetadata } from "@nestjs/common";
import type { ModuleKey, PermissionAction } from "@business-os/shared";

export const REQUIRE_PERMISSION_KEY = "requirePermission";

export interface RequiredPermission {
  module: ModuleKey;
  action: PermissionAction;
}

/** Guard a handler: caller must hold module × action (or be System SuperAdmin). */
export const RequirePermission = (module: ModuleKey, action: PermissionAction) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, { module, action } satisfies RequiredPermission);
