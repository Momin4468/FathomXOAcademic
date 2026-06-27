import { Module } from "@nestjs/common";
import { AuditModule } from "./common/audit/audit.module.js";
import { AuthModule } from "./common/auth/auth.module.js";
import { DbModule } from "./common/db/db.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";

/**
 * Root module. DbModule + AuditModule (global) and AuthModule (global guards:
 * AuthGuard then PermissionGuard) + module 0 (platform) are always on. Phase-1
 * modules 1–6 are added here behind feature flags as they're built.
 */
@Module({
  imports: [DbModule, AuditModule, AuthModule, PlatformModule],
})
export class AppModule {}
