import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";

/** Audit is cross-cutting — global so any module can record sensitive actions. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
