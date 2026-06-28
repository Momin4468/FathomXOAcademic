import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { CustomFieldService } from "../custom-fields/custom-field.service.js";
import { PartyController } from "./party.controller.js";
import { PartyService } from "./party.service.js";
import { ReferenceController } from "./reference.controller.js";
import { ReferenceService } from "./reference.service.js";

/**
 * Module 1 — reference data + directory (DESIGN_SPEC §7). Feature-flagged
 * (`reference`). Imports AuthModule so the global guards/permission engine apply;
 * DbService + AuditService are global.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReferenceController, PartyController],
  providers: [ReferenceService, PartyService, CustomFieldService],
})
export class ReferenceModule {}
