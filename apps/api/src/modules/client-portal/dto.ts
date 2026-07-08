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

/**
 * Auto-provision a portal login from a student id + name (P1 item 8). Either name
 * an EXISTING client party (`partyId`) or give `studentId` + `name` to find/create
 * one. The login id is the student id; the initial password is DERIVED (returned to
 * the admin to hand over) and must be reset on first login (must_reset_password).
 */
export class AutoProvisionDto {
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) studentId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) name?: string;
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
