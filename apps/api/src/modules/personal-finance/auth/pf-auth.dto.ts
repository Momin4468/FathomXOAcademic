import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class PfRegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  /** Suggested from CURRENCIES; any code allowed since amounts are recorded as entered. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  baseCurrency?: string;
}

export class PfLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  totp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}

export class PfRefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class PfLogoutDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class PfEnable2faDto {
  @IsString()
  @MinLength(1)
  secret!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(12)
  code!: string;
}
