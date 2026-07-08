import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";

/** An employee logs work — NO money field exists (the surface never shows a price). */
export class LogWorkDto {
  @IsOptional() @IsUUID() workItemId?: string; // the job it's for (optional at log time)
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsNumber() @Min(0) quantity?: number; // hours / units
  @IsDateString() loggedOn!: string;
}

/** Admin converts a draft log into a priced producer work_line (optionally naming the job). */
export class ConvertLogDto {
  @IsOptional() @IsUUID() workItemId?: string; // falls back to the log's own work_item_id
}
