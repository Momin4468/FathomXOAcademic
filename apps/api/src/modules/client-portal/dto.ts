import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

/** A client-submitted work request → lands as a DRAFT job (admin prices it). */
export class SubmitRequestDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) details?: string;
}

/** A message from the client to the business. */
export class SendMessageDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

// ─── Admin-side (business plane) ──────────────────────────────────────────────

/** Provision a portal login for an EXISTING client party. */
export class ProvisionAccountDto {
  @IsUUID() partyId!: string;
  @IsString() @MinLength(3) @MaxLength(160) loginId!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
}

export class UpdateAccountDto {
  @IsOptional() @IsString() @MinLength(8) @MaxLength(200) password?: string;
  // Admins may only activate/deactivate here — never set lead/invited.
  @IsOptional() @IsIn(["active", "deactivated"]) status?: string;
}

export class AdminReplyDto {
  @IsUUID() partyId!: string;
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}
