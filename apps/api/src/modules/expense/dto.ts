import {
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import {
  COST_BEARERS,
  CURRENCIES,
  EXPENSE_CATEGORIES,
  type CostBearer,
  type Currency,
  type ExpenseCategory,
} from "@business-os/shared";

export class CreateExpenseDto {
  @IsIn(EXPENSE_CATEGORIES) category!: ExpenseCategory;
  @IsNumber() @Min(0) amount!: number;
  @IsDateString() incurredAt!: string;
  @IsIn(COST_BEARERS) costBearer!: CostBearer;
  @IsOptional() @IsObject() costBearerSplitJson?: Record<string, unknown>;
  @IsOptional() @IsUUID() payeePartyId?: string;
  @IsOptional() @IsString() @MaxLength(120) campaignTag?: string;
  @IsOptional() @IsUUID() revenueLinkId?: string;
  @IsOptional() @IsUUID() receiptFileId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  // Subscription/recurring: next payment date + currency (recorded, no FX).
  @IsOptional() @IsDateString() nextDueDate?: string;
  @IsOptional() @IsIn(CURRENCIES) currency?: Currency;
}

export class UpdateExpenseDto {
  @IsOptional() @IsIn(EXPENSE_CATEGORIES) category?: ExpenseCategory;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsDateString() incurredAt?: string;
  @IsOptional() @IsIn(COST_BEARERS) costBearer?: CostBearer;
  @IsOptional() @IsObject() costBearerSplitJson?: Record<string, unknown>;
  @IsOptional() @IsUUID() payeePartyId?: string;
  @IsOptional() @IsString() @MaxLength(120) campaignTag?: string;
  @IsOptional() @IsUUID() revenueLinkId?: string;
  @IsOptional() @IsUUID() receiptFileId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsDateString() nextDueDate?: string;
  @IsOptional() @IsIn(CURRENCIES) currency?: Currency;
}

export class ListExpensesQueryDto {
  @IsOptional() @IsIn(EXPENSE_CATEGORIES) category?: ExpenseCategory;
  @IsOptional() @IsIn(COST_BEARERS) costBearer?: CostBearer;
  @IsOptional() @IsDateString() from?: string; // incurred_at >= from
  @IsOptional() @IsDateString() to?: string; // incurred_at <= to
}
