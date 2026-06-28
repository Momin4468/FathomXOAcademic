import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { CustomFieldController } from "./custom-field.controller.js";
import { CustomFieldService } from "./custom-field.service.js";

/**
 * Module 12 — custom fields (DESIGN_SPEC §2 #10, §8). The admin-defined catalog
 * of structured fields + value validation against it. Exports CustomFieldService
 * so the record modules (work, party, project) validate custom_json at their edit
 * boundary and gate required fields. Gated by the `custom_fields` permission
 * module; registered under FEATURE_CUSTOM_FIELDS.
 */
@Module({
  imports: [AuthModule],
  controllers: [CustomFieldController],
  providers: [CustomFieldService],
  exports: [CustomFieldService],
})
export class CustomFieldsModule {}
