import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { PF_CATEGORY_KINDS, type PfCategoryKind } from "@business-os/shared";

export class CreatePfCategoryDto {
  @IsIn(PF_CATEGORY_KINDS)
  kind!: PfCategoryKind;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class UpdatePfCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class ListPfCategoryQueryDto {
  @IsOptional()
  @IsIn(PF_CATEGORY_KINDS)
  kind?: PfCategoryKind;
}
