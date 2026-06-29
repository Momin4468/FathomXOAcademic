import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { BalanceService } from "./balance.service.js";
import { BillingController } from "./billing.controller.js";
import { ChargeService } from "./charge.service.js";
import { InvoiceService } from "./invoice.service.js";
import { PaymentService } from "./payment.service.js";
import { DbIncomeBridge } from "./income-bridge/db-income-bridge.js";
import { INCOME_BRIDGE } from "./income-bridge/income-bridge.port.js";

/**
 * Module 5 — invoicing, payments/allocation, and bidirectional charges
 * (DESIGN_SPEC §6). Feature-flagged (`billing`). Imports AuthModule for the
 * global guards/permission engine; DbService + AuditService are global.
 *
 * Provides the one-way income bridge (§11) behind the INCOME_BRIDGE token — the
 * DB adapter today, swappable for an HTTP adapter on a physical split.
 */
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    InvoiceService,
    PaymentService,
    ChargeService,
    BalanceService,
    { provide: INCOME_BRIDGE, useClass: DbIncomeBridge },
  ],
  exports: [PaymentService, InvoiceService],
})
export class BillingModule {}
