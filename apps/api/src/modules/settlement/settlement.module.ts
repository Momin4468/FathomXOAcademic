import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { SettlementController } from "./settlement.controller.js";
import { SettlementService } from "./settlement.service.js";

/**
 * Settlement layer (DESIGN_SPEC §4.4, §3) — partner running balance, dated
 * transfers, split/commission derived from legs, platform fee. Gated by the
 * existing billing:* module and registered under FEATURE_BILLING.
 */
@Module({
  imports: [AuthModule],
  controllers: [SettlementController],
  providers: [SettlementService],
})
export class SettlementModule {}
