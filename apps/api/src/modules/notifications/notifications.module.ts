import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";

/**
 * Module 19 — in-app notifications + admin broadcast (P1 item 7; closes UI_AUDIT
 * R6). AuthModule for the global guards/permission engine; DbService + AuditService
 * are global. Gated by FEATURE_NOTIFICATIONS.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
