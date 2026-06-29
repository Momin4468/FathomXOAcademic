import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import { PROFIT_SHARE_BASES, type ProfitShareBasis } from "@business-os/shared";

/** Create an admin-defined source channel (Web/Facebook/…). The channel-as-party
 *  is created with party_type {channel}; medium is free text (no enum → no code). */
export class CreateChannelDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(60) medium!: string; // 'web' | 'facebook' | free text
  @IsOptional() @IsUUID() controllerPartyId?: string; // omitted/null = business
}

export class UpdateChannelDto {
  @IsOptional() @IsString() @MaxLength(60) medium?: string;
  // null clears the controller (→ business); a uuid sets it.
  @IsOptional() @IsUUID() controllerPartyId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/**
 * Set a profit-share entitlement (a date-versioned deal_term, term_type
 * 'profit_share', to_party_id = the beneficiary). basis sets the FORMULA; a
 * sourcePartyId scopes it to one channel (applies_to source:<id>), else it is a
 * standing dividend (applies_to default). Supersede by setting a new effectiveFrom.
 */
export class SetProfitShareTermDto {
  @IsUUID() toPartyId!: string; // the beneficiary (owner/investor/partner)
  @IsIn(PROFIT_SHARE_BASES as unknown as string[]) basis!: ProfitShareBasis;
  @IsNumber() @Min(0) value!: number; // pct (pct bases) or amount (fixed)
  @IsOptional() @IsUUID() sourcePartyId?: string; // a channel/source → source-scoped; else default
  @IsDateString() effectiveFrom!: string;
}

export class ListProfitShareTermsQueryDto {
  @IsOptional() @IsUUID() partyId?: string; // filter to one beneficiary
}

export class MyProfitShareQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
