import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
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
  @IsOptional() @IsBoolean() trackable?: boolean; // child of a project (default true)
  @IsOptional() @IsBoolean() billable?: boolean; // child of a project (default false)
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsBoolean() isEstimate?: boolean;
  @IsOptional() @IsObject() customJson?: Record<string, unknown>;
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
  @IsOptional() @IsBoolean() trackable?: boolean;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsObject() customJson?: Record<string, unknown>;
}

export class TransitionDto {
  @IsIn(WORK_STATES)
  toState!: WorkState;
}

export class ListWorkQueryDto {
  @IsOptional() @IsUUID() doerPartyId?: string;
  @IsOptional() @IsUUID() sourcePartyId?: string;
  @IsOptional() @IsIn(WORK_STATES) workState?: WorkState;
  @IsOptional() @IsString() includeArchived?: string; // "true" to include
}

export class AddLineDto {
  @IsIn(LINE_KINDS) lineKind!: LineKind;
  @IsOptional() @IsUUID() consumerPartyId?: string;
  @IsOptional() @IsUUID() writerPartyId?: string;
  @IsOptional() @IsInt() @Min(0) wordCount?: number;
  @IsOptional() @IsInt() @Min(1) unitCount?: number;
  // clientRate/fixedAmount may be NEGATIVE only for a lineKind='discount' consumer
  // line (P1 item 6) — the service enforces that; writerRate stays non-negative.
  @IsOptional() @IsNumber() clientRate?: number;
  @IsOptional() @IsNumber() @Min(0) writerRate?: number;
  @IsOptional() @IsNumber() fixedAmount?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** Create an ad-hoc bulk-price group over N consumer lines (P1 item 9). */
export class CreatePriceGroupDto {
  @IsOptional() @IsUUID() clientPartyId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsNumber() @Min(0) combinedAmount!: number; // one combined figure for the whole set
  @IsArray() @ArrayMinSize(2) @IsUUID("4", { each: true }) lineIds!: string[]; // lineIds[0] = the anchor
}

/** Re-price a from→to leg pair to a new total (P1 item 6). Posts a delta leg. */
export class RepriceLegDto {
  @IsOptional() @IsUUID() fromPartyId?: string;
  @IsOptional() @IsUUID() toPartyId?: string;
  @IsNumber() @Min(0) newAmount!: number; // the new total for that pair (delta may be negative)
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  // Optionally stamp a work_line's note so the writer sees their fee was adjusted.
  @IsOptional() @IsUUID() stampLineId?: string;
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

// ─── Resit / fail handling (§3/§6/§8) ────────────────────────────────────────
export class ResitWriterDto {
  @IsUUID() partyId!: string; // the resit (second) writer
  @IsUUID() fromPartyId!: string; // the partner paying them
  @IsNumber() @Min(0.01) amount!: number; // their pay (a new positive leg)
  @IsOptional() @IsIn(LINE_KINDS) lineKind?: LineKind; // default 'extra'
  @IsOptional() @IsInt() @Min(0) wordCount?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ClientReversalDto {
  @IsUUID() fromPartyId!: string; // the client (source party)
  @IsUUID() toPartyId!: string; // the partner the client paid
  @IsNumber() @Min(0.01) amount!: number; // the client revenue to reverse (→ 0)
}

export class ResitDto {
  @IsUUID() originalWriterPartyId!: string;
  // Required when originalWriterReduction > 0 and any reversing-leg portion applies.
  @IsOptional() @IsUUID() originalWriterFromPartyId?: string;
  @IsNumber() @Min(0) originalWriterReduction!: number; // origPay − newPay; 0 = unchanged
  @IsOptional() @ValidateNested() @Type(() => ResitWriterDto) resitWriter?: ResitWriterDto;
  @IsOptional() @IsBoolean() zeroClientBilling?: boolean; // default false
  @IsOptional() @ValidateNested() @Type(() => ClientReversalDto) clientReversal?: ClientReversalDto;
  @IsOptional() @IsNumber() @Min(0) reworkCost?: number;
  @IsOptional() @IsBoolean() reopen?: boolean; // default true
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
