import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { PF_INVESTMENT_EVENT_KINDS, type PfInvestmentEventKind } from "@business-os/shared";

export class CreatePfInvestmentDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  /** An investment TYPE — a pf_category with kind='investment'. */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  principal!: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsDateString()
  startedOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreatePfInvestmentEventDto {
  @IsIn(PF_INVESTMENT_EVENT_KINDS)
  kind!: PfInvestmentEventKind;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsDateString()
  occurredOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
