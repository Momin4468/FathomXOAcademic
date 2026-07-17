import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { PARTY_TYPES, REF_KINDS, type PartyType, type RefKind } from "@business-os/shared";

/** Patch a course's descriptive meta (Academic directory inline edit). */
export class UpdateRefMetaDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(120) program?: string;
  @IsOptional() @IsString() @MaxLength(120) referencing?: string;
}

// ─── Reference ───────────────────────────────────────────────────────────────

export class SearchRefQueryDto {
  @IsIn(REF_KINDS)
  kind!: RefKind;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}

export class ResolveRefDto {
  @IsIn(REF_KINDS)
  kind!: RefKind;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  raw!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class AddAliasDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  alias!: string;
}

export class MergeRefDto {
  @IsUUID()
  sourceId!: string;

  @IsUUID()
  targetId!: string;
}

// ─── Party directory ─────────────────────────────────────────────────────────

export class ListPartyQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(PARTY_TYPES)
  type?: PartyType;
}

export class CreatePartyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @IsOptional()
  @IsArray()
  @IsIn(PARTY_TYPES, { each: true })
  partyType?: PartyType[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalRef?: string; // student id etc.

  /** Either a known university id... */
  @IsOptional()
  @IsUUID()
  universityId?: string;

  /** ...or a typed name to resolve-or-create (provisional). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  universityRaw?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  programme?: string;

  @IsOptional()
  @IsObject()
  contact?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  referredByPartyId?: string;

  /** The managing admin (book of business, 0051). SuperAdmin/admins assign a
   *  client or writer to an admin's roster; defaults to the caller for a client. */
  @IsOptional()
  @IsUUID()
  ownerPartyId?: string;

  @IsOptional()
  @IsObject()
  customJson?: Record<string, unknown>;
}

export class UpdatePartyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsArray()
  @IsIn(PARTY_TYPES, { each: true })
  partyType?: PartyType[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalRef?: string;

  @IsOptional()
  @IsUUID()
  universityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  programme?: string;

  @IsOptional()
  @IsObject()
  contact?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  referredByPartyId?: string;

  /** Reassign the managing admin / roster (0051). */
  @IsOptional()
  @IsUUID()
  ownerPartyId?: string;

  @IsOptional()
  @IsObject()
  customJson?: Record<string, unknown>;
}
