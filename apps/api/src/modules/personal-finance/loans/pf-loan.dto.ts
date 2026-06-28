import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from "class-validator";
import { PF_LOAN_DIRECTIONS, PF_LOAN_EVENT_KINDS, type PfLoanDirection, type PfLoanEventKind } from "@business-os/shared";

export class CreatePfLoanDto {
  @IsIn(PF_LOAN_DIRECTIONS)
  direction!: PfLoanDirection;

  @IsString()
  @MaxLength(120)
  counterpartyName!: string;

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
  @IsDateString()
  dueOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreatePfLoanEventDto {
  @IsIn(PF_LOAN_EVENT_KINDS)
  kind!: PfLoanEventKind;

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
