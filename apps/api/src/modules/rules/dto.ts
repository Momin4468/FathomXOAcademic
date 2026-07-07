import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  IsNumber,
} from "class-validator";
import {
  COMP_BASES,
  COST_BEARERS,
  TERM_TYPES,
  type CompBasis,
  type CostBearer,
  type TermType,
} from "@business-os/shared";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const APPLIES_TO_RE = new RegExp(`^(default|client:${UUID}|jobtype:.{1,100})$`);

// ─── deal_term ───────────────────────────────────────────────────────────────

export class CreateDealTermDto {
  @IsOptional() @IsUUID() fromPartyId?: string;
  @IsOptional() @IsUUID() toPartyId?: string;
  @IsOptional() @Matches(APPLIES_TO_RE) appliesTo?: string; // default | client:<uuid> | jobtype:<x>
  @IsIn(TERM_TYPES) termType!: TermType;
  @IsNumber() @Min(0) value!: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
}

export class SupersedeDealTermDto {
  @IsUUID() priorId!: string;
  @IsNumber() @Min(0) value!: number;
  @IsDateString() effectiveFrom!: string;
}

export class ListDealTermsQueryDto {
  @IsOptional() @IsUUID() fromPartyId?: string;
  @IsOptional() @IsUUID() toPartyId?: string;
  @IsOptional() @IsIn(TERM_TYPES) termType?: TermType;
}

export class ResolveDealTermQueryDto {
  @IsUUID() fromPartyId!: string;
  @IsUUID() toPartyId!: string;
  @IsIn(TERM_TYPES) termType!: TermType;
  @IsDateString() asOf!: string;
  @IsOptional() @IsUUID() clientPartyId?: string;
  @IsOptional() @IsString() jobType?: string;
}

// ─── comp_rule ───────────────────────────────────────────────────────────────

export class CreateCompRuleDto {
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @IsIn(COMP_BASES) basis!: CompBasis;
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsIn(COST_BEARERS) costBearer!: CostBearer;
  @IsOptional() @IsObject() costBearerSplitJson?: Record<string, unknown>;
  // when costBearer='party': the partner who bears the comp cost (service enforces).
  @IsOptional() @IsUUID() bearerPartyId?: string;
  @IsOptional() @IsString() cadence?: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
}

export class SupersedeCompRuleDto {
  @IsUUID() priorId!: string;
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsIn(COST_BEARERS) costBearer?: CostBearer;
  @IsOptional() @IsObject() costBearerSplitJson?: Record<string, unknown>;
  @IsOptional() @IsUUID() bearerPartyId?: string;
  @IsDateString() effectiveFrom!: string;
}

export class ListCompRulesQueryDto {
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @IsIn(COMP_BASES) basis?: CompBasis;
}

export class ResolveCompRuleQueryDto {
  @IsDateString() asOf!: string;
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @IsIn(COMP_BASES) basis?: CompBasis;
}

export class PreviewLegsQueryDto {
  @IsOptional() @IsDateString() asOf?: string;
}
