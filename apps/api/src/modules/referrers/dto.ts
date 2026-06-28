import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import { REFERRAL_BASES, type ReferralBasis } from "@business-os/shared";

/** Record/supersede a referrer's standing agreement (a referral_pct deal_term). */
export class SetReferrerTermsDto {
  @IsIn(REFERRAL_BASES) basis!: ReferralBasis;
  /** pct for revenue/margin (e.g. 10 = 10%), or the amount for fixed. */
  @IsNumber() @Min(0) value!: number;
  @IsDateString() effectiveFrom!: string;
  /** Optional per-client override (applies_to=client:<id>); else a default rate. */
  @IsOptional() @IsUUID() clientPartyId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** Set/clear a client's default (one-hop) referrer. */
export class SetClientReferrerDto {
  /** null/omitted clears the default referrer. */
  @IsOptional() @IsUUID() referrerId?: string | null;
}

/** Ask for the suggested referral amount on a job (admin; never throws). */
export class SuggestReferralDto {
  @IsUUID() workItemId!: string;
  /** Explicit referrer; else the job client's direct referred_by (one hop). */
  @IsOptional() @IsUUID() referrerId?: string;
}

/** Attach a referral leg to a job (admin direct-attach; no propose→confirm). */
export class AttachReferralDto {
  @IsUUID() workItemId!: string;
  /** Explicit referrer (the beneficiary); else the job client's direct referred_by. */
  @IsOptional() @IsUUID() referrerId?: string;
  /** Override the suggested amount. Required when there's no agreement to derive from. */
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
}
