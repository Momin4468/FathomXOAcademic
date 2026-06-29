import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class ClientLoginDto {
  @IsString() @MinLength(1) @MaxLength(160) loginId!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
  @IsOptional() @IsString() @MaxLength(12) totp?: string;
  @IsOptional() @IsString() @MaxLength(80) deviceLabel?: string;
}

export class ClientRefreshDto {
  @IsString() @MinLength(1) refreshToken!: string;
}

export class ClientLogoutDto {
  @IsString() @MinLength(1) refreshToken!: string;
}

export class ClientEnable2faDto {
  @IsString() @MinLength(1) secret!: string;
  @IsString() @MinLength(1) @MaxLength(12) code!: string;
}
