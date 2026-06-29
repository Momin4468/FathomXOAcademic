import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { ReferenceModule } from "../refdata/reference.module.js";
import { ChannelsController } from "./channels.controller.js";
import { ChannelsService } from "./channels.service.js";

/**
 * Module 17 — Channels + source-driven routing + N-way profit-share
 * (DESIGN_SPEC §3, §4.4). A channel is a party tagged 'channel' (created via the
 * exported PartyService) used as a job's source; profit shares are date-versioned
 * profit_share deal_terms divided N-way by the pure deriveProfitShares, with the
 * §4.4 opacity guard enforced server-side. Gated by the `channels` permission
 * module; registered under FEATURE_CHANNELS.
 */
@Module({
  imports: [AuthModule, ReferenceModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
})
export class ChannelsModule {}
