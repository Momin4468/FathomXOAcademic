import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from "class-validator";
import { PF_SAVING_EVENT_KINDS, type PfSavingEventKind } from "@business-os/shared";

export class CreatePfSavingDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  targetAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreatePfSavingEventDto {
  @IsIn(PF_SAVING_EVENT_KINDS)
  kind!: PfSavingEventKind;

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
