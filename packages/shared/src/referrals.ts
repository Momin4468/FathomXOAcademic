/**
 * Referral logic (DESIGN_SPEC §4, §8). Pure functions so the API, tests, and web
 * compute identically. A referral is "another claimant leg, scoped like any
 * other" — these helpers only decide the SUGGESTED amount; the leg itself is the
 * money record, and an admin may always override the suggestion.
 *
 * The referral agreement is a deal_term, term_type='referral_pct', keyed on the
 * referrer (from_party_id), with a `basis` of revenue|margin|fixed. Resolution
 * mirrors resolveDealTerm precedence (client-scoped beats default; effective-
 * dated; latest wins ties) but on the referrer-only key.
 */

import { isEffectiveOn, parseAppliesTo, type DealTermLike } from "./rules.js";
import type { ReferralBasis } from "./enums.js";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ReferralTermContext {
  referrerId: string;
  clientPartyId?: string | null;
  asOf: string; // 'YYYY-MM-DD'
}

const createdAtMs = (v: string | Date | null | undefined): number =>
  v == null ? 0 : v instanceof Date ? v.getTime() : new Date(v).getTime();

/**
 * Resolve the winning referral agreement for a referrer (+ optional client
 * override). Candidates are deal_terms with term_type='referral_pct' and
 * from_party_id = the referrer. A client-scoped term (applies_to=client:<id>)
 * beats a default term; ties break to the latest effective_from, then created_at.
 * Returns null when no effective agreement applies (admin then enters an amount).
 */
export function resolveReferralTerm(
  candidates: DealTermLike[],
  ctx: ReferralTermContext,
): DealTermLike | null {
  let best: DealTermLike | null = null;
  let bestScore = -1;

  for (const c of candidates) {
    if (c.termType !== "referral_pct") continue;
    if (c.fromPartyId !== ctx.referrerId) continue;
    if (!isEffectiveOn(c, ctx.asOf)) continue;

    const at = parseAppliesTo(c.appliesTo);
    let appliesScore: number;
    if (at.kind === "client") {
      if (!ctx.clientPartyId || at.id !== ctx.clientPartyId) continue;
      appliesScore = 3;
    } else if (at.kind === "jobtype") {
      // referral terms don't scope by job-type; ignore such rows defensively.
      continue;
    } else {
      appliesScore = 1;
    }

    if (
      appliesScore > bestScore ||
      (appliesScore === bestScore &&
        best !== null &&
        (c.effectiveFrom > best.effectiveFrom ||
          (c.effectiveFrom === best.effectiveFrom &&
            createdAtMs(c.createdAt) >= createdAtMs(best.createdAt))))
    ) {
      best = c;
      bestScore = appliesScore;
    }
  }
  return best;
}

export interface ReferralSuggestionInput {
  basis: ReferralBasis | string | null | undefined;
  value: string | number | null | undefined; // pct (revenue/margin) or amount (fixed)
  revenue?: number | null; // the job's top client price (admin-visible base)
  margin?: number | null; // the job's post-writer margin (admin-visible base)
}

export interface ReferralSuggestion {
  amount: number;
  basis: ReferralBasis;
  rate: number; // the pct (revenue/margin) or the fixed amount (fixed)
}

/**
 * Compute the suggested referral leg amount from the agreement + the (admin-
 * visible) job base. revenue ⇒ round2(revenue × pct%); margin ⇒ round2(margin ×
 * pct%); fixed ⇒ the set amount. Returns null when the basis is unknown or the
 * required base is missing — the caller surfaces "unpriced" so the admin enters
 * an amount manually (capture stays explicit; never a silent 0).
 */
export function computeReferralSuggestion(
  input: ReferralSuggestionInput,
): ReferralSuggestion | null {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return null;

  switch (input.basis) {
    case "revenue": {
      if (input.revenue == null || !Number.isFinite(input.revenue)) return null;
      return { amount: round2((input.revenue * value) / 100), basis: "revenue", rate: value };
    }
    case "margin": {
      if (input.margin == null || !Number.isFinite(input.margin)) return null;
      return { amount: round2((input.margin * value) / 100), basis: "margin", rate: value };
    }
    case "fixed": {
      return { amount: round2(value), basis: "fixed", rate: value };
    }
    default:
      return null;
  }
}
