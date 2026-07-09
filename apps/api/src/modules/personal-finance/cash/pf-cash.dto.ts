import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreatePfCashCheckinDto {
  @IsDateString()
  asOf!: string;

  /** Declared cash-on-hand — may legitimately be 0. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  declaredAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
