import { Injectable } from "@nestjs/common";
import { schema, type Db } from "@business-os/db";
import { resolveDealTerm, type DealTermLike } from "@business-os/shared";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

/** A priced leg: the resolved amount + the term it came from. */
export interface LegPrice {
  amount: string; // numeric(14,2) string
  dealTermId: string;
  termType: "per_word" | "fixed";
}

interface PriceLegArgs {
  fromPartyId: string | null;
  toPartyId: string | null;
  asOf: string; // 'YYYY-MM-DD'
  wordCount: number | null;
  clientPartyId: string | null;
  jobType?: string | null;
}

/** Round to 2dp to match leg.amount numeric(14,2). */
const round2 = (n: number): string => n.toFixed(2);

/**
 * Auto-pricing for the leg chain (DESIGN_SPEC §3). Reuses the SHARED pure
 * resolver (`resolveDealTerm`) so the precedence + effective-dating logic lives
 * in exactly one place; only the candidate fetch is co-located here. This keeps
 * the work module decoupled from RulesModule (no cross-module DI / feature-flag
 * coupling).
 *
 * A leg is an ABSOLUTE handoff price: per_word → value × word_count, fixed →
 * value. The percentage term types (split/commission/referral) divide margin at
 * settlement and never set a leg amount.
 */
@Injectable()
export class PricingService {
  /** Fetch candidates for (from→to)-or-global on `termType`, effective on asOf, then rank. */
  private async resolveTerm(
    tx: Db,
    args: {
      fromPartyId: string;
      toPartyId: string;
      termType: "per_word" | "fixed";
      asOf: string;
      clientPartyId: string | null;
      jobType?: string | null;
    },
  ): Promise<DealTermLike | null> {
    const candidates = await tx
      .select()
      .from(schema.dealTerm)
      .where(
        and(
          eq(schema.dealTerm.termType, args.termType),
          or(
            and(
              eq(schema.dealTerm.fromPartyId, args.fromPartyId),
              eq(schema.dealTerm.toPartyId, args.toPartyId),
            ),
            and(isNull(schema.dealTerm.fromPartyId), isNull(schema.dealTerm.toPartyId)),
          ),
          lte(schema.dealTerm.effectiveFrom, args.asOf),
          or(isNull(schema.dealTerm.effectiveTo), gt(schema.dealTerm.effectiveTo, args.asOf)),
        ),
      );
    return resolveDealTerm(candidates as DealTermLike[], {
      fromPartyId: args.fromPartyId,
      toPartyId: args.toPartyId,
      termType: args.termType,
      clientPartyId: args.clientPartyId,
      jobType: args.jobType ?? null,
      asOf: args.asOf,
    });
  }

  /**
   * Price one leg from the resolved deal term. Prefers a per_word term (needs a
   * word count) and falls back to a fixed term. Returns null when neither
   * resolves (caller decides: error on save, "unpriced" on propose).
   */
  async priceLeg(tx: Db, args: PriceLegArgs): Promise<LegPrice | null> {
    // No relationship → nothing to resolve (open-ended legs are priced manually).
    if (!args.fromPartyId || !args.toPartyId) return null;
    const base = {
      fromPartyId: args.fromPartyId,
      toPartyId: args.toPartyId,
      asOf: args.asOf,
      clientPartyId: args.clientPartyId,
      jobType: args.jobType ?? null,
    };

    if (args.wordCount != null) {
      const pw = await this.resolveTerm(tx, { ...base, termType: "per_word" });
      if (pw) {
        return {
          amount: round2(Number(pw.value) * args.wordCount),
          dealTermId: pw.id,
          termType: "per_word",
        };
      }
    }

    const fx = await this.resolveTerm(tx, { ...base, termType: "fixed" });
    if (fx) {
      return { amount: round2(Number(fx.value)), dealTermId: fx.id, termType: "fixed" };
    }

    return null;
  }
}
