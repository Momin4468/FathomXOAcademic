import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { ExpenseController } from "./expense.controller.js";
import { ExpenseService } from "./expense.service.js";

/** Module 6 — expenses with a cost-bearer (DESIGN_SPEC §3.5). Gated `expenses:*`. */
@Module({
  imports: [AuthModule],
  controllers: [ExpenseController],
  providers: [ExpenseService],
})
export class ExpenseModule {}
