import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { IMPORT_ENTITIES, type ImportEntity } from "@business-os/shared";

export class ImportEntityDto {
  @IsIn(IMPORT_ENTITIES)
  entity!: ImportEntity;
}

/** Archive metadata (sent alongside a multipart file, or with a `url` for a link). */
export class ArchiveCreateDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  docDate?: string;

  /** Comma-separated tags. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;

  /** For a large file: a link instead of an upload. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;
}
