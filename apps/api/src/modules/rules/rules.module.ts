import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { RulesController } from "./rules.controller.js";
import { RulesService } from "./rules.service.js";

/**
 * Module 3 — deal terms + comp rules (effective-dated rules engine; DESIGN_SPEC
 * §3.4–3.5). Feature-flagged (`rules`). Imports AuthModule for the global
 * guards/permission engine; DbService + AuditService are global.
 */
@Module({
  imports: [AuthModule],
  controllers: [RulesController],
  providers: [RulesService],
})
export class RulesModule {}
