import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { AdminController } from "./admin.controller.js";
import { PlatformController } from "./platform.controller.js";

/**
 * Module 0 — Platform / tenancy / access. Health + whoami + the minimal user/role
 * admin surface. Imports AuthModule for PasswordService/PermissionService. Always
 * on (the spine); other modules are feature-flagged.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformController, AdminController],
})
export class PlatformModule {}
