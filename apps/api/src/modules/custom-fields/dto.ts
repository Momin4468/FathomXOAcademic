import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  CUSTOM_FIELD_TARGETS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldTarget,
  type CustomFieldType,
} from "@business-os/shared";

export class CreateCustomFieldDto {
  @IsIn(CUSTOM_FIELD_TARGETS) targetEntity!: CustomFieldTarget;
  @IsString() @MinLength(1) @MaxLength(200) fieldName!: string;
  @IsIn(CUSTOM_FIELD_TYPES) fieldType!: CustomFieldType;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(200, { each: true }) options?: string[];
  @IsOptional() @IsObject() scope?: Record<string, string>; // {clientPartyId?, universityRefId?, assignmentTypeRefId?}
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() @Min(0) sort?: number;
}

export class UpdateCustomFieldDto {
  // field_type and target_entity are immutable (changing them orphans stored values).
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) fieldName?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(200, { each: true }) options?: string[];
  @IsOptional() @IsObject() scope?: Record<string, string>;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() @Min(0) sort?: number;
  @IsOptional() @IsBoolean() active?: boolean; // false → archive; true → un-archive
}

export class ListCustomFieldQueryDto {
  @IsOptional() @IsIn(CUSTOM_FIELD_TARGETS) targetEntity?: CustomFieldTarget;
  @IsOptional() @IsString() includeArchived?: string; // "true" to include
}

export class SearchCustomFieldQueryDto {
  @IsIn(CUSTOM_FIELD_TARGETS) targetEntity!: CustomFieldTarget;
  @IsUUID() fieldId!: string;
  @IsString() @MinLength(1) @MaxLength(200) q!: string;
}
