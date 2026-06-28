import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import { CREDENTIAL_TYPES, type CredentialType } from "@business-os/shared";

export class CreateCredentialDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsIn(CREDENTIAL_TYPES) type!: CredentialType;
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @IsOptional() @IsUUID() clientPartyId?: string;
  // The secret bundle — encrypted as one blob; never stored/echoed in plaintext.
  @IsOptional() @IsString() @MaxLength(500) username?: string;
  @IsOptional() @IsString() @MaxLength(500) password?: string;
  @IsOptional() @IsString() @MaxLength(4000) totpRecovery?: string;
  @IsOptional() @IsString() @MaxLength(8000) notes?: string;
}

export class UpdateCredentialDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsIn(CREDENTIAL_TYPES) type?: CredentialType;
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @IsOptional() @IsUUID() clientPartyId?: string;
  // Provide ANY secret field to rotate the whole bundle (all four are re-encrypted).
  @IsOptional() @IsString() @MaxLength(500) username?: string;
  @IsOptional() @IsString() @MaxLength(500) password?: string;
  @IsOptional() @IsString() @MaxLength(4000) totpRecovery?: string;
  @IsOptional() @IsString() @MaxLength(8000) notes?: string;
}

export class GrantShareDto {
  @IsUUID() partyId!: string;
}

export class RevealDto {
  @Matches(/^\d{6}$/, { message: "totp must be a 6-digit code" }) totp!: string;
}
