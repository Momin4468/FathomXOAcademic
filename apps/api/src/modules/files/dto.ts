import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { FILE_KINDS, type FileKind } from "@business-os/shared";

/** Non-file form fields on a multipart upload (the file itself is @UploadedFile). */
export class UploadMetaDto {
  @IsOptional() @IsIn(FILE_KINDS) kind?: FileKind;
}

/** A large file / video stored as a link only (no bytes). */
export class LinkFileDto {
  @Matches(/^https?:\/\//i, { message: "url must be an http(s) link" })
  @MaxLength(2000)
  url!: string;
  @IsIn(FILE_KINDS) kind!: FileKind;
  @IsOptional() @IsString() @MaxLength(300) filename?: string;
}
