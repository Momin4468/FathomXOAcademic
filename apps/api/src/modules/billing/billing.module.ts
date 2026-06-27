import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { BalanceService } from "./balance.service.js";
import { BillingController } from "./billing.controller.js";
import { ChargeService } from "./charge.service.js";
import { InvoiceService } from "./invoice.service.js";
import { PaymentService } from "./payment.service.js";

/**
 * Module 5 — invoicing, payments/allocation, and bidirectional charges
 * (DESIGN_SPEC §6). Feature-flagged (`billing`). Imports AuthModule for the
 * global guards/permission engine; DbService + AuditService are global.
 */
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [InvoiceService, PaymentService, ChargeService, BalanceService],
})
export class BillingModule {}
