import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

/** Shared shape for a manual income or expense entry. Multi-currency, no forced FX. */
class PfEntryBaseDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string; // recorded as entered; defaults BDT

  /** Optional user-entered converted amount (NO automatic FX). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  convertedAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  convertedCurrency?: string;

  @IsDateString()
  occurredOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreatePfIncomeDto extends PfEntryBaseDto {}
export class CreatePfExpenseDto extends PfEntryBaseDto {}

export class ListPfEntryQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
