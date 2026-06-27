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

export class Enable2faDto {
  @IsString()
  @MinLength(1)
  secret!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(12)
  code!: string;
}
