import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import {
  resolveCompRule,
  resolveDealTerm,
  type CompRuleLike,
  type DealTermLike,
  type SessionPrincipal,
  type TermType,
} from "@business-os/shared";
import { and, asc, eq, gt, isNull, lte, or, type SQL } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type {
  CreateCompRuleDto,
  CreateDealTermDto,
  ResolveCompRuleQueryDto,
  ResolveDealTermQueryDto,
  SupersedeCompRuleDto,
  SupersedeDealTermDto,
} from "./dto.js";

const day = (s: string): string => s.slice(0, 10); // normalize ISO → 'YYYY-MM-DD'
const numOrNull = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : String(v);

@Injectable()
export class RulesService {
  constructor(private readonly audit: AuditService) {}

  // ─── deal_term ──────────────────────────────────────────────────────────────

  async createDealTerm(tx: Db, principal: SessionPrincipal, dto: CreateDealTermDto) {
    if (dto.effectiveTo && day(dto.effectiveTo) <= day(dto.effectiveFrom)) {
      throw new BadRequestException("effectiveTo must be after effectiveFrom");
    }
    const [row] = await tx
      .insert(schema.dealTerm)
      .values({
        orgId: principal.orgId,
        fromPartyId: dto.fromPartyId ?? null,
        toPartyId: dto.toPartyId ?? null,
        appliesTo: dto.appliesTo ?? "default",
        termType: dto.termType,
        value: String(dto.value),
        effectiveFrom: day(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? day(dto.effectiveTo) : null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "rules.deal_term_created",
      entity: "deal_term",
      entityId: row!.id,
      detail: { termType: dto.termType, value: dto.value, effectiveFrom: day(dto.effectiveFrom) },
    });
    return row!;
  }

  /** Renegotiation: close the prior version, insert a new one. Value never mutated. */
  async supersedeDealTerm(tx: Db, principal: SessionPrincipal, dto: SupersedeDealTermDto) {
    const [prior] = await tx
      .select()
      .from(schema.dealTerm)
      .where(eq(schema.dealTerm.id, dto.priorId));
    if (!prior) throw new NotFoundException("Prior deal term not found");
    if (prior.effectiveTo !== null) {
      throw new BadRequestException("Cannot supersede an already-closed version (supersede the open one)");
    }
    const from = day(dto.effectiveFrom);
    if (from <= prior.effectiveFrom) {
      throw new BadRequestException("New effectiveFrom must be after the prior version's");
    }
    await tx
      .update(schema.dealTerm)
      .set({ effectiveTo: from })
      .where(eq(schema.dealTerm.id, prior.id));
    const [next] = await tx
      .insert(schema.dealTerm)
      .values({
        orgId: principal.orgId,
        fromPartyId: prior.fromPartyId,
        toPartyId: prior.toPartyId,
        appliesTo: prior.appliesTo,
        termType: prior.termType,
        value: String(dto.value),
        effectiveFrom: from,
        effectiveTo: null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "rules.deal_term_superseded",
      entity: "deal_term",
      entityId: next!.id,
      detail: { priorId: prior.id, oldValue: prior.value, newValue: dto.value, effectiveFrom: from },
    });
    return next!;
  }

  async listDealTerms(
    tx: Db,
    filters: { fromPartyId?: string; toPartyId?: string; termType?: TermType },
  ) {
    const conds: SQL[] = [];
    if (filters.fromPartyId) conds.push(eq(schema.dealTerm.fromPartyId, filters.fromPartyId));
    if (filters.toPartyId) conds.push(eq(schema.dealTerm.toPartyId, filters.toPartyId));
    if (filters.termType) conds.push(eq(schema.dealTerm.termType, filters.termType));
    return tx
      .select()
      .from(schema.dealTerm)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(schema.dealTerm.effectiveFrom));
  }

  async resolveDealTerm(tx: Db, q: ResolveDealTermQueryDto) {
    const asOf = day(q.asOf);
    const candidates = await tx
      .select()
      .from(schema.dealTerm)
      .where(
        and(
          eq(schema.dealTerm.termType, q.termType),
          or(
            and(
              eq(schema.dealTerm.fromPartyId, q.fromPartyId),
              eq(schema.dealTerm.toPartyId, q.toPartyId),
            ),
            and(isNull(schema.dealTerm.fromPartyId), isNull(schema.dealTerm.toPartyId)),
          ),
          lte(schema.dealTerm.effectiveFrom, asOf),
          or(isNull(schema.dealTerm.effectiveTo), gt(schema.dealTerm.effectiveTo, asOf)),
        ),
      );
    const resolved = resolveDealTerm(candidates as DealTermLike[], {
      fromPartyId: q.fromPartyId,
      toPartyId: q.toPartyId,
      termType: q.termType,
      clientPartyId: q.clientPartyId ?? null,
      jobType: q.jobType ?? null,
      asOf,
    });
    return { asOf, resolved, candidateCount: candidates.length };
  }

  // ─── comp_rule ──────────────────────────────────────────────────────────────

  async createCompRule(tx: Db, principal: SessionPrincipal, dto: CreateCompRuleDto) {
    if (!dto.partyId && !dto.roleId) {
      throw new BadRequestException("A comp rule needs a partyId or a roleId");
    }
    if (dto.effectiveTo && day(dto.effectiveTo) <= day(dto.effectiveFrom)) {
      throw new BadRequestException("effectiveTo must be after effectiveFrom");
    }
    const [row] = await tx
      .insert(schema.compRule)
      .values({
        orgId: principal.orgId,
        partyId: dto.partyId ?? null,
        roleId: dto.roleId ?? null,
        basis: dto.basis,
        rate: numOrNull(dto.rate),
        costBearer: dto.costBearer,
        costBearerSplitJson: dto.costBearerSplitJson ?? null,
        cadence: dto.cadence ?? null,
        effectiveFrom: day(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? day(dto.effectiveTo) : null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "rules.comp_rule_created",
      entity: "comp_rule",
      entityId: row!.id,
      detail: { basis: dto.basis, costBearer: dto.costBearer, effectiveFrom: day(dto.effectiveFrom) },
    });
    return row!;
  }

  async supersedeCompRule(tx: Db, principal: SessionPrincipal, dto: SupersedeCompRuleDto) {
    const [prior] = await tx
      .select()
      .from(schema.compRule)
      .where(eq(schema.compRule.id, dto.priorId));
    if (!prior) throw new NotFoundException("Prior comp rule not found");
    if (prior.effectiveTo !== null) {
      throw new BadRequestException("Cannot supersede an already-closed version (supersede the open one)");
    }
    const from = day(dto.effectiveFrom);
    if (from <= prior.effectiveFrom) {
      throw new BadRequestException("New effectiveFrom must be after the prior version's");
    }
    await tx
      .update(schema.compRule)
      .set({ effectiveTo: from })
      .where(eq(schema.compRule.id, prior.id));
    const [next] = await tx
      .insert(schema.compRule)
      .values({
        orgId: principal.orgId,
        partyId: prior.partyId,
        roleId: prior.roleId,
        basis: prior.basis,
        rate: dto.rate !== undefined ? numOrNull(dto.rate) : prior.rate,
        costBearer: dto.costBearer ?? prior.costBearer,
        costBearerSplitJson: prior.costBearerSplitJson,
        cadence: prior.cadence,
        effectiveFrom: from,
        effectiveTo: null,
        createdBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "rules.comp_rule_superseded",
      entity: "comp_rule",
      entityId: next!.id,
      detail: {
        priorId: prior.id,
        effectiveFrom: from,
        oldRate: prior.rate,
        newRate: next!.rate,
        oldCostBearer: prior.costBearer,
        newCostBearer: next!.costBearer,
      },
    });
    return next!;
  }

  async listCompRules(
    tx: Db,
    filters: { partyId?: string; roleId?: string; basis?: string },
  ) {
    const conds: SQL[] = [];
    if (filters.partyId) conds.push(eq(schema.compRule.partyId, filters.partyId));
    if (filters.roleId) conds.push(eq(schema.compRule.roleId, filters.roleId));
    if (filters.basis) conds.push(eq(schema.compRule.basis, filters.basis));
    return tx
      .select()
      .from(schema.compRule)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(schema.compRule.effectiveFrom));
  }

  async resolveCompRule(tx: Db, q: ResolveCompRuleQueryDto) {
    const asOf = day(q.asOf);
    const orConds: SQL[] = [];
    if (q.partyId) orConds.push(eq(schema.compRule.partyId, q.partyId));
    if (q.roleId) {
      orConds.push(and(isNull(schema.compRule.partyId), eq(schema.compRule.roleId, q.roleId))!);
    }
    if (!orConds.length) return { asOf, resolved: null, candidateCount: 0 };
    const candidates = await tx
      .select()
      .from(schema.compRule)
      .where(
        and(
          or(...orConds),
          lte(schema.compRule.effectiveFrom, asOf),
          or(isNull(schema.compRule.effectiveTo), gt(schema.compRule.effectiveTo, asOf)),
          q.basis ? eq(schema.compRule.basis, q.basis) : undefined,
        ),
      );
    const resolved = resolveCompRule(candidates as CompRuleLike[], {
      partyId: q.partyId ?? null,
      roleId: q.roleId ?? null,
      basis: q.basis ?? null,
      asOf,
    });
    return { asOf, resolved, candidateCount: candidates.length };
  }

  /**
   * Read-only preview: resolve the deal terms on the job's source→doer
   * relationship and the doer's comp rule, as-of the job's date (or override).
   * Does NOT write any leg — auto-application is Module 5.
   */
  async previewLegs(tx: Db, workItemId: string, asOfOverride?: string) {
    const [item] = await tx
      .select({
        id: schema.workItem.id,
        sourcePartyId: schema.workItem.sourcePartyId,
        doerPartyId: schema.workItem.doerPartyId,
        createdAt: schema.workItem.createdAt,
      })
      .from(schema.workItem)
      .where(eq(schema.workItem.id, workItemId));
    if (!item) throw new NotFoundException("Work item not found");

    const asOf = day(asOfOverride ?? item.createdAt.toISOString());
    const dealTerms: Record<string, unknown> = {};
    if (item.sourcePartyId && item.doerPartyId) {
      for (const termType of ["per_word", "fixed", "split_pct"] as TermType[]) {
        const r = await this.resolveDealTerm(tx, {
          fromPartyId: item.sourcePartyId,
          toPartyId: item.doerPartyId,
          termType,
          asOf,
        });
        if (r.resolved) dealTerms[termType] = r.resolved;
      }
    }
    const compRule = item.doerPartyId
      ? (await this.resolveCompRule(tx, { partyId: item.doerPartyId, asOf })).resolved
      : null;

    return { workItemId, asOf, dealTerms, compRule };
  }
}
