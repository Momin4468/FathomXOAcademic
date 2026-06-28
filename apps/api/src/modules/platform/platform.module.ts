import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { AdminController } from "./admin.controller.js";
import { PersonalLinkController } from "./personal-link.controller.js";
import { PersonalLinkService } from "./personal-link.service.js";
import { PlatformController } from "./platform.controller.js";

/**
 * Module 0 — Platform / tenancy / access. Health + whoami + the minimal user/role
 * admin surface + the business side of the PF income-link seam (§11). Imports
 * AuthModule for PasswordService/PermissionService. Always on (the spine).
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformController, AdminController, PersonalLinkController],
  providers: [PersonalLinkService],
})
export class PlatformModule {}
