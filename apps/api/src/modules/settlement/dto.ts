import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class SettlementQueryDto {
  @IsUUID() partnerA!: string;
  @IsUUID() partnerB!: string;
}

export class RecordTransferDto {
  @IsUUID() fromPartyId!: string;
  @IsUUID() toPartyId!: string;
  @IsNumber() @Min(0) amount!: number;
  @IsDateString() transferredAt!: string;
  @IsOptional() @IsString() @MaxLength(64) medium?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ReverseTransferDto {
  @IsUUID() originalId!: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class ListTransfersQueryDto {
  @IsOptional() @IsUUID() partyId?: string;
}

export class ApplyPlatformFeeDto {
  @IsUUID() partyId!: string;
  @IsUUID() workItemId!: string;
}
