import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import {
  CHARGE_CATEGORIES,
  OTHER_INCOME_CATEGORIES,
  PAYMENT_DIRECTIONS,
  PAYMENT_MEDIUMS,
  PROOF_SIDES,
  type ChargeCategory,
  type OtherIncomeCategory,
  type PaymentDirection,
  type PaymentMedium,
  type ProofSide,
} from "@business-os/shared";

// ─── invoices ────────────────────────────────────────────────────────────────
export class CreateInvoiceDto {
  @IsUUID() clientPartyId!: string;
  @IsOptional() @IsBoolean() isEstimate?: boolean;
}
export class AttachLineDto {
  @IsUUID() workLineId!: string;
  /** Attach to a specific invoice (e.g. an estimate); else the client's open one. */
  @IsOptional() @IsUUID() invoiceId?: string;
}
export class MoveLineDto {
  @IsUUID() invoiceLineId!: string;
  @IsUUID() targetInvoiceId!: string;
}
export class ListInvoicesQueryDto {
  @IsOptional() @IsUUID() clientPartyId?: string;
  @IsOptional() @IsString() status?: string;
}

// ─── payments ────────────────────────────────────────────────────────────────
export class RecordPaymentDto {
  @IsIn(PAYMENT_DIRECTIONS) direction!: PaymentDirection;
  @IsOptional() @IsUUID() counterpartyPartyId?: string;
  @IsNumber() @Min(0) amount!: number; // BDT (the ledger currency)
  @IsDateString() paidAt!: string;
  @IsOptional() @IsIn(PAYMENT_MEDIUMS) medium?: PaymentMedium;
  // Multi-currency provenance (0037): the foreign original + rate; amount stays BDT.
  @IsOptional() @IsString() @MaxLength(8) originalCurrency?: string;
  @IsOptional() @IsNumber() @Min(0) originalAmount?: number;
  @IsOptional() @IsNumber() @Min(0) fxRate?: number;
  @IsOptional() @IsString() @MaxLength(120) trxId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class AllocationItemDto {
  @IsOptional() @IsUUID() invoiceLineId?: string;
  @IsOptional() @IsUUID() writerPartyId?: string;
  @IsOptional() @IsUUID() chargeId?: string;
  @IsNumber() @Min(0) amount!: number;
}
export class AllocateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  items!: AllocationItemDto[];
}
export class ReversePaymentDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
export class AttachProofDto {
  @IsUUID() fileObjectId!: string;
  @IsIn(PROOF_SIDES) side!: ProofSide;
}
export class ListPaymentsQueryDto {
  @IsOptional() @IsUUID() counterpartyPartyId?: string;
}

// ─── charges (bidirectional: party→business) ─────────────────────────────────
export class CreateChargeDto {
  @IsUUID() partyId!: string;
  @IsIn(CHARGE_CATEGORIES) category!: ChargeCategory;
  @IsNumber() @Min(0) amount!: number;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsOptional() @IsUUID() workItemId?: string;
  @IsOptional() @IsUUID() dealTermId?: string;
}
export class ReverseChargeDto {
  @IsUUID() originalId!: string;
  // party + amount are derived from the source charge (server-side), not trusted here.
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
export class ListChargesQueryDto {
  @IsUUID() partyId!: string;
}

// ─── other income (business income that is NOT a client leg; 0037) ─────────────
export class CreateOtherIncomeDto {
  @IsNumber() @Min(0) amount!: number; // BDT
  @IsIn(OTHER_INCOME_CATEGORIES) category!: OtherIncomeCategory;
  @IsDateString() occurredOn!: string;
  @IsOptional() @IsString() @MaxLength(8) originalCurrency?: string;
  @IsOptional() @IsNumber() @Min(0) originalAmount?: number;
  @IsOptional() @IsNumber() @Min(0) fxRate?: number;
  @IsOptional() @IsUUID() sourcePaymentId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class ReverseOtherIncomeDto {
  @IsUUID() originalId!: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
