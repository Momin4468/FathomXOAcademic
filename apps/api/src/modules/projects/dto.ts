import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { MILESTONE_STATES, PROJECT_STATUSES, type MilestoneState, type ProjectStatus } from "@business-os/shared";

export class CreateProjectDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsUUID() clientPartyId?: string;
  // Instantiate this template's items as the project's starting milestones.
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsNumber() @Min(0) estimateAmount?: number;
  @IsOptional() @IsIn(PROJECT_STATUSES) status?: ProjectStatus;
  @IsOptional() @IsObject() customJson?: Record<string, unknown>;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsUUID() clientPartyId?: string;
  @IsOptional() @IsNumber() @Min(0) estimateAmount?: number;
  @IsOptional() @IsIn(PROJECT_STATUSES) status?: ProjectStatus;
  @IsOptional() @IsObject() customJson?: Record<string, unknown>;
}

/** Extend a project with another template's items (callable repeatedly). */
export class InstantiateDto {
  @IsUUID() templateId!: string;
}

export class CreateMilestoneDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsBoolean() trackable?: boolean;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsInt() sort?: number;
  // Deadline: either a precomputed absolute instant + zone, OR wall date+time+zone.
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) dueTime?: string;
  @IsOptional() @IsString() @MaxLength(64) dueTz?: string; // IANA zone
}

export class UpdateMilestoneDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsBoolean() trackable?: boolean;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) dueTime?: string;
  @IsOptional() @IsString() @MaxLength(64) dueTz?: string;
}

export class MilestoneTransitionDto {
  @IsIn(MILESTONE_STATES) state!: MilestoneState;
}

export class CreateTemplateDto {
  @IsString() @MinLength(1) @MaxLength(300) name!: string;
  @IsOptional() @IsUUID() scopeRefId?: string; // uni/programme this template is for
}

export class CreateTemplateItemDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsBoolean() trackable?: boolean;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsInt() sort?: number;
}

export class ListProjectsQueryDto {
  @IsOptional() @IsUUID() clientPartyId?: string;
  @IsOptional() @IsIn(PROJECT_STATUSES) status?: ProjectStatus;
}
