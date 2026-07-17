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
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import {
  GROUP_KINDS,
  GROUP_SCOPES,
  LINE_KINDS,
  WORK_LINE_STATUSES,
  WORK_STATES,
  type GroupKind,
  type GroupScope,
  type LineKind,
  type WorkLineStatus,
  type WorkState,
} from "@business-os/shared";

/**
 * §3.1 academic fields shared by create + update (0048). `clientPartyId` is the
 * paying student, kept DISTINCT from `sourcePartyId` (the referral/source that
 * drives profit-share). Everything is optional — capture-first, complete later.
 */
class WorkItemFieldsDto {
  @IsOptional() @IsUUID() sourcePartyId?: string;
  @IsOptional() @IsUUID() clientPartyId?: string;
  @IsOptional() @IsUUID() doerPartyId?: string;
  @IsOptional() @IsUUID() ownerPartyId?: string; // owning admin (book of business, 0051)
  @IsOptional() @IsUUID() courseRefId?: string;
  @IsOptional() @IsUUID() assignmentTypeRefId?: string;
  @IsOptional() @IsUUID() universityRefId?: string;
  @IsOptional() @IsString() @MaxLength(300) moduleName?: string;
  @IsOptional() @IsIn(GROUP_KINDS) groupKind?: GroupKind;
  @IsOptional() @IsIn(GROUP_SCOPES) groupScope?: GroupScope; // full | partial (when group)
  @IsOptional() @IsString() @MaxLength(1000) groupNote?: string;
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsDateString() submissionDate?: string;
  @IsOptional() @IsInt() @Min(0) wordCount?: number;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() milestoneId?: string;
  @IsOptional() @IsBoolean() trackable?: boolean;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsString() @MaxLength(4000) details?: string;
  @IsOptional() @IsObject() customJson?: Record<string, unknown>;
}

export class CreateWorkItemDto extends WorkItemFieldsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsOptional() @IsBoolean() isEstimate?: boolean;
}

export class UpdateWorkItemDto extends WorkItemFieldsDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
}

/** Move a single work_line through its lifecycle (0048, Phase 4A). */
export class SetLineStatusDto {
  @IsIn(WORK_LINE_STATUSES) to!: WorkLineStatus;
}

/**
 * Inline-edit a work_line's fields (the grid's pre-bill cell edit). A BILLED line
 * is rejected (its amount changes via reprice). clientRate/fixedAmount (client
 * price) are applied only for an admin (work:approve) — a writer edits their own
 * writerRate / counts / note.
 */
export class UpdateLineDto {
  @IsOptional() @IsInt() @Min(0) wordCount?: number;
  @IsOptional() @IsInt() @Min(1) unitCount?: number;
  @IsOptional() @IsString() @MaxLength(30) unitLabel?: string; // words | slides | pages | weight% | copies
  @IsOptional() @IsNumber() clientRate?: number; // admin only
  @IsOptional() @IsNumber() @Min(0) writerRate?: number;
  @IsOptional() @IsNumber() fixedAmount?: number; // admin only (client-side)
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class TransitionDto {
  @IsIn(WORK_STATES)
  toState!: WorkState;
}

export class ListWorkQueryDto {
  @IsOptional() @IsUUID() doerPartyId?: string;
  @IsOptional() @IsUUID() sourcePartyId?: string;
  @IsOptional() @IsUUID() clientPartyId?: string;
  @IsOptional() @IsIn(WORK_STATES) workState?: WorkState;
  @IsOptional() @IsString() includeArchived?: string; // "true" to include
}

/** One part (assignment/tutorial/chapter) of a course/thesis/project bundle. */
export class BundlePartDto {
  @IsString() @MinLength(1) @MaxLength(300) detail!: string;
  @IsOptional() @IsInt() @Min(0) wordCount?: number;
  @IsOptional() @IsNumber() @Min(0) clientAmount?: number;
  @IsOptional() @IsNumber() @Min(0) writerAmount?: number;
}

/** "Add course / thesis / project" — one parent + N priced parts in one entry. */
export class CreateBundleDto {
  @IsIn(["course", "thesis", "project"]) kind!: "course" | "thesis" | "project";
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsUUID() courseRefId?: string;
  @IsOptional() @IsUUID() clientPartyId?: string;
  @IsOptional() @IsUUID() doerPartyId?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => BundlePartDto) parts!: BundlePartDto[];
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

/**
 * Hand a job off to ANOTHER admin (0051) — the COMMISSION model (Case A: "Emon
 * gives to Momin, Emon takes 10-20%"). The owner keeps `ownerCutPct` of the
 * client price; a leg owner→toAdmin at clientPrice × (1 − cut) is posted
 * (append-only), and the job + its client are SHARED with the receiving admin
 * (roster grants) so they can pick it up and assign their own writer. Each admin
 * then sees only their own hop's margin (leg RLS), so the owner's real client
 * price never leaks to the receiver.
 *
 * "Split the post-writer extra between the two admins" (Case B) is a DIFFERENT,
 * §4.4-guarded thing (a partner↔partner profit split can leak the other's
 * margin) — do that through the existing channel-scoped profit-share in Settings,
 * NOT here. This action is a straight commission on the client price.
 */
export class HandoffDto {
  @IsUUID() toAdminPartyId!: string;
  @IsNumber() @Min(0) @Max(100) ownerCutPct!: number; // % of the client price the owner keeps
  // Optional explicit client price when the chain has no client→owner leg yet.
  @IsOptional() @IsNumber() @Min(0) clientAmount?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
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
