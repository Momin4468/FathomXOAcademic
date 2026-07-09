import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { BalanceService } from "../billing/balance.service.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";

/**
 * Module 13 — role-scoped dashboards (DESIGN_SPEC §8, §10). Composes existing
 * derived read-models (BalanceService + work_item states) under the viewer's RLS
 * plus owner-level aggregate definers (dashboard / leaderboard / charts). Gated by
 * FEATURE_DASHBOARD; the owner analytics section is gated by `dashboard:approve`
 * in-service. Native charts replaced the former Metabase embed.
 */
@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService, BalanceService],
})
export class DashboardModule {}
