import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { deriveMargins, type SessionPrincipal } from "@business-os/shared";
import { asc, eq, inArray } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import type { AppendLegsDto, LegSpecDto } from "./dto.js";
import { PricingService } from "./pricing.service.js";

export interface LegView {
  id: string;
  seq: number;
  fromPartyId: string | null;
  toPartyId: string | null;
  amount: string;
  workLineId: string | null;
}

/** A resolved leg ready to insert: amount + provenance (the term it came from). */
interface ResolvedLeg {
  spec: LegSpecDto;
  amount: string;
  dealTermId: string | null;
  source: "derived" | "manual";
}

/** A proposal (no write): what /propose returns per leg. */
export interface LegProposal {
  seq: number;
  fromPartyId: string | null;
  toPartyId: string | null;
  amount: string | null;
  dealTermId: string | null;
  termType: "per_word" | "fixed" | null;
  source: "derived" | "manual" | "unpriced";
}

/** Pricing context derived from the work item once per request. */
interface PricingScope {
  asOf: string;
  clientPartyId: string | null;
  lineWordCount: Map<string, number | null>;
}

/**
 * The money chain (SCHEMA §D, DESIGN_SPEC §3.1). Legs are append-only and
 * RLS-protected: getVisibleLegs returns ONLY the legs the caller is party to
 * (or all, for System SuperAdmin) — a non-party gets zero rows. Margin is
 * derived from those visible legs, never stored.
 *
 * Leg amounts AUTO-FILL from the resolved deal term (per_word/fixed) when the
 * caller omits an amount, recording provenance in leg.deal_term_id; an explicit
 * amount overrides and clears the link.
 */
@Injectable()
export class LegService {
  constructor(
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
  ) {}

  /** Admin builds/append the chain. Append-only (no update/delete on legs). */
  async appendLegs(
    tx: Db,
    principal: SessionPrincipal,
    workItemId: string,
    dto: AppendLegsDto,
  ) {
    this.validateChain(dto);
    const scope = await this.buildScope(tx, workItemId, dto);

    const resolved: ResolvedLeg[] = [];
    for (const l of dto.legs) {
      resolved.push(await this.resolveLeg(tx, scope, l));
    }

    // NOTE: no RETURNING — under leg RLS, an admin building the chain isn't a
    // party to every leg, so reading the row back would trip the SELECT policy.
    // Generate ids client-side instead.
    const inserted: string[] = [];
    for (const r of resolved) {
      const id = randomUUID();
      await tx.insert(schema.leg).values({
        id,
        orgId: principal.orgId,
        workItemId,
        workLineId: r.spec.workLineId ?? null,
        seq: r.spec.seq,
        fromPartyId: r.spec.fromPartyId ?? null,
        toPartyId: r.spec.toPartyId ?? null,
        amount: r.amount,
        dealTermId: r.dealTermId,
        note: r.spec.note ?? null,
        createdBy: principal.userId,
      });
      inserted.push(id);
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "leg.chain_appended",
      entity: "work_item",
      entityId: workItemId,
      // The actor's own action — record the figures for reconciliation (S5).
      detail: {
        count: inserted.length,
        legs: resolved.map((r) => ({
          seq: r.spec.seq,
          fromPartyId: r.spec.fromPartyId ?? null,
          toPartyId: r.spec.toPartyId ?? null,
          amount: r.amount,
          dealTermId: r.dealTermId,
          source: r.source,
        })),
      },
    });
    return { legIds: inserted };
  }

  /**
   * Read-only price proposal for the chain-builder (capture-first). Same
   * resolution as append, but writes nothing and never throws on an unpriceable
   * leg — it returns source:'unpriced' so the UI can prompt for a manual amount.
   */
  async proposeLegs(
    tx: Db,
    _principal: SessionPrincipal,
    workItemId: string,
    dto: AppendLegsDto,
  ): Promise<{ proposals: LegProposal[] }> {
    this.validateChain(dto);
    const scope = await this.buildScope(tx, workItemId, dto);

    const proposals: LegProposal[] = [];
    for (const l of dto.legs) {
      if (l.amount != null) {
        proposals.push({
          seq: l.seq,
          fromPartyId: l.fromPartyId ?? null,
          toPartyId: l.toPartyId ?? null,
          amount: String(l.amount),
          dealTermId: null,
          termType: null,
          source: "manual",
        });
        continue;
      }
      const priced = await this.pricing.priceLeg(tx, {
        fromPartyId: l.fromPartyId ?? null,
        toPartyId: l.toPartyId ?? null,
        asOf: scope.asOf,
        wordCount: this.wordCountFor(l, scope),
        clientPartyId: scope.clientPartyId,
      });
      proposals.push({
        seq: l.seq,
        fromPartyId: l.fromPartyId ?? null,
        toPartyId: l.toPartyId ?? null,
        amount: priced?.amount ?? null,
        dealTermId: priced?.dealTermId ?? null,
        termType: priced?.termType ?? null,
        source: priced ? "derived" : "unpriced",
      });
    }
    return { proposals };
  }

  /** RLS filters this to the caller's own legs (or all for SuperAdmin). */
  async getVisibleLegs(tx: Db, workItemId: string): Promise<LegView[]> {
    return tx
      .select({
        id: schema.leg.id,
        seq: schema.leg.seq,
        fromPartyId: schema.leg.fromPartyId,
        toPartyId: schema.leg.toPartyId,
        amount: schema.leg.amount,
        workLineId: schema.leg.workLineId,
      })
      .from(schema.leg)
      .where(eq(schema.leg.workItemId, workItemId))
      .orderBy(asc(schema.leg.seq));
  }

  /** Margins derived from the visible legs (structural opacity). */
  marginsFor(legs: LegView[]) {
    return deriveMargins(legs);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /** Load the work item + word counts once; derive the pricing as-of + client. */
  private async buildScope(tx: Db, workItemId: string, dto: AppendLegsDto): Promise<PricingScope> {
    const [item] = await tx
      .select({
        sourcePartyId: schema.workItem.sourcePartyId,
        createdAt: schema.workItem.createdAt,
      })
      .from(schema.workItem)
      .where(eq(schema.workItem.id, workItemId));
    if (!item) throw new NotFoundException("Work item not found");

    // Validate any referenced work_line belongs to THIS item, and capture its
    // word count for per_word pricing (RLS already scopes org; one round-trip).
    const lineIds = dto.legs.map((l) => l.workLineId).filter((x): x is string => !!x);
    const lineWordCount = new Map<string, number | null>();
    if (lineIds.length) {
      const found = await tx
        .select({
          id: schema.workLine.id,
          workItemId: schema.workLine.workItemId,
          wordCount: schema.workLine.wordCount,
        })
        .from(schema.workLine)
        .where(inArray(schema.workLine.id, lineIds));
      const own = found.filter((r) => r.workItemId === workItemId);
      const ok = new Set(own.map((r) => r.id));
      for (const lid of lineIds) {
        if (!ok.has(lid)) throw new BadRequestException(`work_line ${lid} is not on this work item`);
      }
      for (const r of own) lineWordCount.set(r.id, r.wordCount ?? null);
    }

    const asOf = (dto.asOf ?? item.createdAt.toISOString()).slice(0, 10);
    return { asOf, clientPartyId: item.sourcePartyId ?? null, lineWordCount };
  }

  /** Each leg connects two distinct parties (or has exactly one open end). */
  private validateChain(dto: AppendLegsDto) {
    for (const l of dto.legs) {
      if (!l.fromPartyId && !l.toPartyId) {
        throw new BadRequestException(`Leg seq ${l.seq} needs a from or to party`);
      }
      if (l.fromPartyId && l.toPartyId && l.fromPartyId === l.toPartyId) {
        throw new BadRequestException(`Leg seq ${l.seq}: from and to must differ`);
      }
    }
  }

  /** Per-leg word count: explicit, else the linked work_line's, else null. */
  private wordCountFor(l: LegSpecDto, scope: PricingScope): number | null {
    if (l.wordCount != null) return l.wordCount;
    if (l.workLineId) return scope.lineWordCount.get(l.workLineId) ?? null;
    return null;
  }

  /** Manual amount overrides (clears the term link); else auto-price or reject. */
  private async resolveLeg(tx: Db, scope: PricingScope, l: LegSpecDto): Promise<ResolvedLeg> {
    if (l.amount != null) {
      return { spec: l, amount: String(l.amount), dealTermId: null, source: "manual" };
    }
    const priced = await this.pricing.priceLeg(tx, {
      fromPartyId: l.fromPartyId ?? null,
      toPartyId: l.toPartyId ?? null,
      asOf: scope.asOf,
      wordCount: this.wordCountFor(l, scope),
      clientPartyId: scope.clientPartyId,
    });
    if (!priced) {
      throw new BadRequestException(
        `Cannot price leg seq ${l.seq} — no matching deal term; provide an amount`,
      );
    }
    return { spec: l, amount: priced.amount, dealTermId: priced.dealTermId, source: "derived" };
  }
}
