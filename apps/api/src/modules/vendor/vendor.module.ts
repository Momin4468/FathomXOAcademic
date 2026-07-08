import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { BalanceService } from "../billing/balance.service.js";
import { VendorController } from "./vendor.controller.js";
import { VendorService } from "./vendor.service.js";

/**
 * Module 21 — vendor self-service invoicing (audit item 13). A vendor is a light
 * business-plane user; the self-view reuses BalanceService + leg RLS. Gated by
 * FEATURE_VENDOR.
 */
@Module({
  imports: [AuthModule],
  controllers: [VendorController],
  providers: [VendorService, BalanceService],
})
export class VendorModule {}
