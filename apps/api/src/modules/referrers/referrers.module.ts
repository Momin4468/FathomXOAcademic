import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { BalanceService } from "../billing/balance.service.js";
import { ReferrersController } from "./referrers.controller.js";
import { ReferrersService } from "./referrers.service.js";

/**
 * Module 11 — Referrers (DESIGN_SPEC §4, §8). A referral is a claimant leg
 * (business→referrer), scoped by the existing leg-visibility RLS so a referrer
 * sees only their own income + the works that generated it; payout flows through
 * the existing earnings model (BalanceService). Gated by the `referrers`
 * permission module; registered under FEATURE_REFERRERS.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReferrersController],
  providers: [ReferrersService, BalanceService],
})
export class ReferrersModule {}
