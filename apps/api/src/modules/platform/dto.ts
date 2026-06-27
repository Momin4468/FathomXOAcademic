import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  /** Optional link to an existing party (link, never merge). */
  @IsOptional()
  @IsUUID()
  partyId?: string;
}

export class AssignRoleDto {
  @IsUUID()
  roleId!: string;
}
