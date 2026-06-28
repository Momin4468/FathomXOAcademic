import { Module } from "@nestjs/common";
import { AuthModule } from "../../common/auth/auth.module.js";
import { CustomFieldService } from "../custom-fields/custom-field.service.js";
import { MilestoneService } from "./milestone.service.js";
import { ProjectService } from "./project.service.js";
import { ProjectsController } from "./projects.controller.js";
import { TemplateService } from "./template.service.js";

/**
 * Projects / engagements (DESIGN_SPEC §5) — a container of child work_items with
 * milestones (tz-aware due) and per-uni/programme milestone templates. Same
 * machinery as plain jobs (a plain job is the one-child case); gated by the
 * existing work:* permission module and registered under FEATURE_WORK.
 */
@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectService, MilestoneService, TemplateService, CustomFieldService],
})
export class ProjectsModule {}
