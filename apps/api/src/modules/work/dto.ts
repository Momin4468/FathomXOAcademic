import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { LINE_KINDS, WORK_STATES, type LineKind, type WorkState } from "@business-os/shared";

export class CreateWorkItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsOptional() @IsString() @MaxLength(4000) details?: string;
  @IsOptional() @IsUUID() sourcePartyId?: string;
  @IsOptional() @IsUUID() doerPartyId?: string;
  @IsOptional() @IsUUID() courseRefId?: string;
  @IsOptional() @IsUUID() assignmentTypeRefId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() milestoneId?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsBoolean() isEstimate?: boolean;
}

export class UpdateWorkItemDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) details?: string;
  @IsOptional() @IsUUID() sourcePartyId?: string;
  @IsOptional() @IsUUID() doerPartyId?: string;
  @IsOptional() @IsUUID() courseRefId?: string;
  @IsOptional() @IsUUID() assignmentTypeRefId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() milestoneId?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class TransitionDto {
  @IsIn(WORK_STATES)
  toState!: WorkState;
}

export class ListWorkQueryDto {
  @IsOptional() @IsUUID() doerPartyId?: string;
  @IsOptional() @IsIn(WORK_STATES) workState?: WorkState;
  @IsOptional() @IsString() includeArchived?: string; // "true" to include
}

export class AddLineDto {
  @IsIn(LINE_KINDS) lineKind!: LineKind;
  @IsOptional() @IsUUID() consumerPartyId?: string;
  @IsOptional() @IsUUID() writerPartyId?: string;
  @IsOptional() @IsInt() @Min(0) wordCount?: number;
  @IsOptional() @IsInt() @Min(1) unitCount?: number;
  @IsOptional() @IsNumber() @Min(0) clientRate?: number;
  @IsOptional() @IsNumber() @Min(0) writerRate?: number;
  @IsOptional() @IsNumber() @Min(0) fixedAmount?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ProducerSpecDto {
  @IsOptional() @IsUUID() writerPartyId?: string;
  @IsOptional() @IsInt() @Min(0) wordCount?: number;
  @IsOptional() @IsNumber() @Min(0) writerRate?: number;
  @IsOptional() @IsNumber() @Min(0) fixedAmount?: number;
}

export class ConsumerSpecDto {
  @IsUUID() consumerPartyId!: string;
  @IsOptional() @IsInt() @Min(0) wordCount?: number;
  @IsOptional() @IsNumber() @Min(0) clientRate?: number;
  @IsOptional() @IsNumber() @Min(0) fixedAmount?: number;
}

export class FanOutDto {
  @ValidateNested()
  @Type(() => ProducerSpecDto)
  producer!: ProducerSpecDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConsumerSpecDto)
  consumers!: ConsumerSpecDto[];
}

export class LegSpecDto {
  @IsInt() @Min(1) seq!: number;
  @IsOptional() @IsUUID() fromPartyId?: string;
  @IsOptional() @IsUUID() toPartyId?: string;
  // Optional: omit to auto-price from the resolved deal term; provide to override.
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  // Optional per-leg word count for per_word pricing (else the linked work_line's).
  @IsOptional() @IsInt() @Min(0) wordCount?: number;
  @IsOptional() @IsUUID() workLineId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class AppendLegsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LegSpecDto)
  legs!: LegSpecDto[];

  // Pricing as-of date (defaults to the job's created_at). Reused by /propose.
  @IsOptional() @IsDateString() asOf?: string;
}
