import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { ExpenseController } from "./expense.controller.js";
import { ExpenseService } from "./expense.service.js";
import { ReminderService } from "./reminder.service.js";

/** Module 6 — expenses with a cost-bearer (DESIGN_SPEC §3.5). Gated `expenses:*`.
 *  Hosts the subscription-reminder runner + its daily @Cron. */
@Module({
  imports: [AuthModule],
  controllers: [ExpenseController],
  providers: [ExpenseService, ReminderService],
  exports: [ExpenseService],
})
export class ExpenseModule {}
