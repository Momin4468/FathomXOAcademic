import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { ChecksController } from "./checks.controller.js";
import { ChecksService } from "./checks.service.js";

/**
 * Module 10 — the AI/plagiarism check service (DESIGN_SPEC §8): a self-contained
 * mini-business with a batch-tally board, claim→confirm governance, top-up credit
 * cost basis, and a derived standalone P&L. Gated by the `checks` permission
 * module; registered under FEATURE_CHECKS.
 */
@Module({
  imports: [AuthModule],
  controllers: [ChecksController],
  providers: [ChecksService],
})
export class ChecksModule {}
