import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { CHECK_BATCH_STATES, type CheckBatchState } from "@business-os/shared";

export class CreateChannelDto {
  @IsString() @MinLength(1) @MaxLength(200) label!: string;
  @IsOptional() @IsUUID() employeePartyId?: string; // defaults to the caller's party
}

export class UpdateChannelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) label?: string;
  @IsOptional() @IsUUID() employeePartyId?: string;
  @IsOptional() archived?: boolean;
}

export class CreateToolAccountDto {
  @IsString() @MinLength(1) @MaxLength(200) label!: string;
  @IsOptional() @IsUUID() vaultItemId?: string;
}

export class TopupDto {
  @IsNumber() @Min(0.01) credits!: number; // positive only; corrections are a future negative-row path
  @IsNumber() @Min(0) cost!: number;
  @IsDateString() purchasedAt!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class RecordBatchDto {
  @IsUUID() channelId!: string;
  @IsOptional() @IsUUID() toolAccountId?: string;
  @IsDateString() periodDate!: string;
  @IsInt() @Min(0) filesChecked!: number;
  @IsInt() @Min(0) filesPaid!: number;
  @IsNumber() @Min(0) amountCollected!: number;
  @IsOptional() @IsUUID() customerPartyId?: string;
  @IsOptional() @IsUUID() workItemId?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class UpdateBatchDto {
  @IsOptional() @IsUUID() toolAccountId?: string;
  @IsOptional() @IsDateString() periodDate?: string;
  @IsOptional() @IsInt() @Min(0) filesChecked?: number;
  @IsOptional() @IsInt() @Min(0) filesPaid?: number;
  @IsOptional() @IsNumber() @Min(0) amountCollected?: number;
  @IsOptional() @IsUUID() customerPartyId?: string;
  @IsOptional() @IsUUID() workItemId?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class AddCheckFileDto {
  @IsOptional() @IsUUID() fileObjectId?: string;
  @IsOptional() @IsString() @MaxLength(300) customerRef?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) aiScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) plagiarismScore?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ListBatchesQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() channelId?: string;
  @IsOptional() @IsIn(CHECK_BATCH_STATES) status?: CheckBatchState;
}

export class PnlQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
