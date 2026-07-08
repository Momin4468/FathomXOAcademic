import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

export const ADVANCE_DIRECTIONS = ["given", "taken"] as const;
export const ADVANCE_EVENT_KINDS = ["disbursement", "repayment", "adjustment"] as const;

/**
 * Create an advance/loan header (P1 item 11). Either name an EXISTING counterparty
 * party (`counterpartyPartyId`) or give a `counterpartyName` to create a provisional
 * directory party (writers, vendors, or people not otherwise in the system).
 */
export class CreateAdvanceDto {
  @ValidateIf((o) => !o.counterpartyName) @IsUUID() counterpartyPartyId?: string;
  @ValidateIf((o) => !o.counterpartyPartyId) @IsString() @MinLength(1) @MaxLength(200) counterpartyName?: string;

  @IsIn(ADVANCE_DIRECTIONS) direction!: (typeof ADVANCE_DIRECTIONS)[number];
  @IsNumber() @Min(0.01) principal!: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsDateString() startedOn!: string;
  @IsOptional() @IsDateString() dueOn?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** Record an append-only advance event (disbursement/repayment/adjustment). */
export class CreateAdvanceEventDto {
  @IsIn(ADVANCE_EVENT_KINDS) kind!: (typeof ADVANCE_EVENT_KINDS)[number];
  // Amount is signed by convention only for 'adjustment'; disbursement/repayment are positive.
  @IsNumber() amount!: number;
  @IsDateString() occurredOn!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
