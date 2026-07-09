import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { MODULES, PERMISSION_ACTIONS, type ModuleKey, type PermissionAction } from "@business-os/shared";

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

export class CreateRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class TogglePermissionDto {
  @IsIn(MODULES as readonly string[])
  module!: ModuleKey;

  @IsIn(PERMISSION_ACTIONS as readonly string[])
  action!: PermissionAction;

  @IsBoolean()
  granted!: boolean;
}
