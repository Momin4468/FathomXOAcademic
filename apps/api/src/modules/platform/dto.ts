import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { MODULES, PERMISSION_ACTIONS, type ModuleKey, type PermissionAction } from "@business-os/shared";

export class CreateUserDto {
  @IsEmail()
  email!: string;

  /** Optional: set an initial password directly. Omit (or set sendInvite) to
   *  invite instead — the user gets an emailed "set your password" link. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password?: string;

  /** Email a set-password invite instead of setting a password here. */
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;

  /** Optional link to an existing party (link, never merge). */
  @IsOptional()
  @IsUUID()
  partyId?: string;
}

export class AssignRoleDto {
  @IsUUID()
  roleId!: string;
}

/** Enable/disable a login (a disabled account cannot authenticate; never deleted). */
export class SetUserStatusDto {
  @IsIn(["active", "disabled"])
  status!: "active" | "disabled";
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
