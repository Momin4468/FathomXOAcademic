import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { AdvancesController } from "./advances.controller.js";
import { AdvancesService } from "./advances.service.js";

/**
 * Module 20 — business-plane loan/advance ledger (P1 item 11). AuthModule for the
 * global guards/permission engine; DbService + AuditService are global. Gated by
 * FEATURE_ADVANCES. Exported so the balance surface can compose party outstanding.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdvancesController],
  providers: [AdvancesService],
  exports: [AdvancesService],
})
export class AdvancesModule {}
