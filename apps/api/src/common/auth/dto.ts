import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  /** Required only if the account has 2FA enabled. */
  @IsOptional()
  @IsString()
  @MaxLength(12)
  totp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

/** Request a reset link for an email-keyed plane (business, PF). */
export class RequestResetDto {
  @IsEmail()
  email!: string;
}

/** Set a new password using an emailed reset token (all planes). */
export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}

/** Self-service password change for the authenticated account. */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}

export class Enable2faDto {
  @IsString()
  @MinLength(1)
  secret!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(12)
  code!: string;
}
