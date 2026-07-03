import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const ROLLUP = ["week", "month", "custom"] as const;
const BUDGET_PERIODS = ["month", "year"] as const;

/** PATCH — every field optional; only provided keys are updated. */
export class UpdatePfPreferencesDto {
  @IsOptional() @IsIn(ROLLUP) rollupPeriod?: (typeof ROLLUP)[number];
  @IsOptional() @IsInt() @Min(1) @Max(366) rollupCustomDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(30) subscriptionLeadDays?: number;
  @IsOptional() @IsBoolean() reminderSubscriptions?: boolean;
  @IsOptional() @IsBoolean() reminderNotes?: boolean;
  @IsOptional() @IsBoolean() anomalyEnabled?: boolean;
  /** Sensitivity: flag a period/category ≥ recent-average × pct/100. Higher = less noisy. */
  @IsOptional() @IsInt() @Min(110) @Max(500) anomalyThresholdPct?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(8, { each: true }) activeCurrencies?: string[];
  @IsOptional() @IsIn(BUDGET_PERIODS) defaultBudgetPeriod?: (typeof BUDGET_PERIODS)[number];
  @IsOptional() @IsBoolean() aiQuickaddEnabled?: boolean;
  /** Edits pf_account.base_currency (the default/aggregation currency). */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(8) defaultCurrency?: string;
}
