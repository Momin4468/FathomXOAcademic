import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import {
  AVAILABILITY_STATES,
  REVISION_FAULTS,
  SATISFACTION_LEVELS,
  type AvailabilityState,
  type RevisionFault,
  type SatisfactionLevel,
} from "@business-os/shared";

export class RecordOutcomeDto {
  @IsUUID() workItemId!: string;
  @IsOptional() @IsBoolean() onTime?: boolean;
  @IsOptional() @IsInt() daysLate?: number;
  @IsOptional() @IsInt() @Min(0) revisionCount?: number;
  @IsOptional() @IsIn(REVISION_FAULTS) revisionFault?: RevisionFault;
  @IsOptional() @IsString() @MaxLength(100) grade?: string;
  @IsOptional() @IsString() @MaxLength(4000) markerFeedback?: string;
  @IsOptional() @IsBoolean() complaint?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) complaintReason?: string;
  @IsOptional() @IsBoolean() failed?: boolean;
  @IsOptional() @IsNumber() @Min(0) aiScore?: number;
  @IsOptional() @IsIn(SATISFACTION_LEVELS) satisfaction?: SatisfactionLevel;
  @IsOptional() @IsNumber() @Min(0) reworkCost?: number;
  @IsOptional() @IsBoolean() disputed?: boolean;
}

/** All fields optional; workItemId is fixed at record time (not editable). */
export class UpdateOutcomeDto {
  @IsOptional() @IsBoolean() onTime?: boolean;
  @IsOptional() @IsInt() daysLate?: number;
  @IsOptional() @IsInt() @Min(0) revisionCount?: number;
  @IsOptional() @IsIn(REVISION_FAULTS) revisionFault?: RevisionFault;
  @IsOptional() @IsString() @MaxLength(100) grade?: string;
  @IsOptional() @IsString() @MaxLength(4000) markerFeedback?: string;
  @IsOptional() @IsBoolean() complaint?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) complaintReason?: string;
  @IsOptional() @IsBoolean() failed?: boolean;
  @IsOptional() @IsNumber() @Min(0) aiScore?: number;
  @IsOptional() @IsIn(SATISFACTION_LEVELS) satisfaction?: SatisfactionLevel;
  @IsOptional() @IsNumber() @Min(0) reworkCost?: number;
  @IsOptional() @IsBoolean() disputed?: boolean;
}

export class ListOutcomesQueryDto {
  @IsOptional() @IsUUID() workItemId?: string;
  @IsOptional() @IsUUID() writerPartyId?: string;
}

export class WriterProfileDto {
  @IsOptional() @IsArray() @IsString({ each: true }) expertiseTags?: string[];
  @IsOptional() @IsIn(AVAILABILITY_STATES) availability?: AvailabilityState;
  @IsOptional() @IsInt() @Min(0) maxConcurrent?: number;
}
