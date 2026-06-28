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
import {
  PF_TARGET_KINDS,
  PF_TARGET_PERIODS,
  type PfTargetKind,
  type PfTargetPeriod,
} from "@business-os/shared";

export class CreatePfTargetDto {
  @IsIn(PF_TARGET_KINDS)
  kind!: PfTargetKind;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsIn(PF_TARGET_PERIODS)
  period!: PfTargetPeriod;

  @IsDateString()
  periodStart!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
