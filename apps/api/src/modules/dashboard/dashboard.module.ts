import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { BalanceService } from "../billing/balance.service.js";
import { AnalyticsController } from "./analytics.controller.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";
import { MetabaseEmbedService } from "./metabase-embed.service.js";

/**
 * Module 13 — role-scoped dashboards (DESIGN_SPEC §8, §10). Composes existing
 * derived read-models (BalanceService + work_item states) under the viewer's RLS
 * plus owner-level aggregate definers. Gated by FEATURE_DASHBOARD; the owner
 * analytics section is gated by the `dashboard:approve` permission in-service.
 */
@Module({
  imports: [AuthModule],
  controllers: [DashboardController, AnalyticsController],
  providers: [DashboardService, BalanceService, MetabaseEmbedService],
})
export class DashboardModule {}
