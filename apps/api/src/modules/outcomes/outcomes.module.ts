import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { OutcomeService } from "./outcome.service.js";
import { OutcomesController } from "./outcomes.controller.js";

/**
 * Module 7 — per-work outcomes + derived reputation + writer expertise/
 * course-history/availability (DESIGN_SPEC §8). Gated by the `outcomes`
 * permission module; registered under FEATURE_OUTCOMES.
 */
@Module({
  imports: [AuthModule],
  controllers: [OutcomesController],
  providers: [OutcomeService],
})
export class OutcomesModule {}
