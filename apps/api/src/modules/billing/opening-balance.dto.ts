import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";
import { CURRENCIES, type Currency } from "@business-os/shared";

/** Create a one-time opening balance (Phase 5). `amount` is signed. */
export class CreateOpeningBalanceDto {
  @IsOptional() @IsUUID() partyId?: string; // omit = the business overall
  @IsNumber() amount!: number; // + owed to the party, − owed by them
  @IsOptional() @IsIn(CURRENCIES) currency?: Currency;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf!: string; // a real date; may be in the past
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
