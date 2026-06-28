import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { KNOWLEDGE_TYPES, type KnowledgeType } from "@business-os/shared";

export class CreateArticleDto {
  @IsIn(KNOWLEDGE_TYPES) type!: KnowledgeType;
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(50000) body?: string;
  @IsOptional() @IsUUID() universityRefId?: string;
  @IsOptional() @IsUUID() programmeRefId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) attachmentFileIds?: string[];
}

export class UpdateArticleDto {
  @IsOptional() @IsIn(KNOWLEDGE_TYPES) type?: KnowledgeType;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(50000) body?: string;
  @IsOptional() @IsUUID() universityRefId?: string;
  @IsOptional() @IsUUID() programmeRefId?: string;
  @IsOptional() @IsIn(["draft", "published"]) status?: "draft" | "published";
}

export class AttachDto {
  @IsUUID() fileObjectId!: string;
}

export class ListArticlesQueryDto {
  @IsOptional() @IsIn(KNOWLEDGE_TYPES) type?: KnowledgeType;
  @IsOptional() @IsUUID() universityRefId?: string;
}

export class CreateCoverSheetDto {
  @IsString() @MinLength(1) @MaxLength(300) name!: string;
  @IsOptional() @IsUUID() universityRefId?: string;
  @IsOptional() @IsUUID() programmeRefId?: string;
  @IsOptional() @IsUUID() fileObjectId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateCoverSheetDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) name?: string;
  @IsOptional() @IsUUID() universityRefId?: string;
  @IsOptional() @IsUUID() programmeRefId?: string;
  @IsOptional() @IsUUID() fileObjectId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class ListCoverSheetsQueryDto {
  @IsOptional() @IsUUID() universityRefId?: string;
}
