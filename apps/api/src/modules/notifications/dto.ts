import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

export const AUDIENCE_KINDS = ["all", "role", "users"] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

/**
 * Admin broadcast (notifications:approve). Fans out to one notification per
 * recipient: everyone active in the org (`all`), a whole role (`role` + roleId),
 * or a named set (`users` + userIds). Validated at the boundary — the target id(s)
 * are required for their audience kind.
 */
export class BroadcastDto {
  @IsIn(AUDIENCE_KINDS) audienceKind!: AudienceKind;

  @ValidateIf((o) => o.audienceKind === "role")
  @IsUUID()
  roleId?: string;

  @ValidateIf((o) => o.audienceKind === "users")
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("4", { each: true })
  @Type(() => String)
  userIds?: string[];

  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
}
