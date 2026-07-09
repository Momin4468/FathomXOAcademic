import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { AuthModule } from "../../common/auth/auth.module.js";
import { AdminController } from "./admin.controller.js";
import { PermissionCatalogService } from "./permission-catalog.service.js";
import { PersonalLinkController } from "./personal-link.controller.js";
import { PersonalLinkService } from "./personal-link.service.js";
import { PlatformController } from "./platform.controller.js";
import { RolesController } from "./roles.controller.js";
import { RolesService } from "./roles.service.js";

/**
 * Module 0 — Platform / tenancy / access. Health + whoami + the user/role admin
 * surface (RBAC management) + the business side of the PF income-link seam (§11).
 * Imports AuthModule (PasswordService/PermissionService) and DiscoveryModule (the
 * permission catalog reflects @RequirePermission usage across all controllers).
 * Always on (the spine).
 */
@Module({
  imports: [AuthModule, DiscoveryModule],
  controllers: [PlatformController, AdminController, PersonalLinkController, RolesController],
  providers: [PersonalLinkService, RolesService, PermissionCatalogService],
})
export class PlatformModule {}
