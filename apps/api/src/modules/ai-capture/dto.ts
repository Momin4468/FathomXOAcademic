import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { AI_CAPTURE_KINDS, type AiCaptureKind } from "@business-os/shared";

export class CaptureDto {
  @IsIn(AI_CAPTURE_KINDS)
  kind!: AiCaptureKind;

  /** For text / whatsapp. */
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  text?: string;

  /** For image / voice — a file uploaded first via the file pipeline. */
  @IsOptional()
  @IsUUID()
  fileObjectId?: string;
}

export class EditProposalDto {
  /** The corrected draft fields (merged into proposed_json before Accept). */
  @IsObject()
  fields!: Record<string, unknown>;
}
