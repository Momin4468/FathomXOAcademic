import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { LineService } from "../work/line.service.js";
import { HrmController } from "./hrm.controller.js";
import { HrmService } from "./hrm.service.js";

/**
 * Module 22 — HRM employee work-logging (audit item 12). Reuses LineService to
 * convert a log into a priced producer work_line. Salary-owner attribution is
 * already handled by the expenses/cost_bearer path (0036). Gated FEATURE_HRM.
 */
@Module({
  imports: [AuthModule],
  controllers: [HrmController],
  providers: [HrmService, LineService],
})
export class HrmModule {}
