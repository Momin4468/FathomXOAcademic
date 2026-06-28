import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { NOTE_COLORS, type NoteColor } from "@business-os/shared";

/** One checklist line in a note. */
export class NoteItemDto {
  @IsString()
  @MaxLength(500)
  text!: string;

  @IsBoolean()
  done!: boolean;
}

export class CreateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NoteItemDto)
  items?: NoteItemDto[];

  @IsOptional()
  @IsIn(NOTE_COLORS)
  color?: NoteColor;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsDateString()
  remindOn?: string;
}

export class UpdateNoteDto extends CreateNoteDto {}

export class ListNotesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** "true" → show archived instead of active. */
  @IsOptional()
  @IsString()
  archived?: string;
}

export class AddNoteLinkDto {
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;
}
