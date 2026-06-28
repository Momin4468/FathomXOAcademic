import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { ChargeService } from "../billing/charge.service.js";
import { CustomFieldService } from "../custom-fields/custom-field.service.js";
import { LegService } from "./leg.service.js";
import { LineService } from "./line.service.js";
import { PricingService } from "./pricing.service.js";
import { ResitService } from "./resit.service.js";
import { WorkController } from "./work.controller.js";
import { WorkService } from "./work.service.js";

/**
 * Module 2 — work items, lines (copy fan-out), and the leg chain with derived
 * margins (DESIGN_SPEC §3, SCHEMA §C/§D). Feature-flagged (`work`). Imports
 * AuthModule for the global guards/permission engine; DbService + AuditService
 * are global.
 */
@Module({
  imports: [AuthModule],
  controllers: [WorkController],
  providers: [WorkService, LineService, LegService, PricingService, ResitService, ChargeService, CustomFieldService],
})
export class WorkModule {}
