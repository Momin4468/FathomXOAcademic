/**
 * N-way profit-share (DESIGN_SPEC §3, §4.4) — PURE so the API, DB tests, and web
 * compute identically and the partner-visibility logic stays auditable. Nothing
 * here reads a private leg: it operates only on the job's already-computed money
 * bases (revenue / writer cost — produced by the profit_share_pool() SECURITY
 * DEFINER fn for an entitled caller) and the tenant-readable profit_share terms.
 *
 * A profit-share entitlement is a deal_term, term_type='profit_share', keyed on
 * the BENEFICIARY (to_party_id; from_party_id = NULL = the business pays it),
 * with a `basis` of pct_of_net | pct_after_writer | pct_of_channel | fixed and a
 * scope (applies_to default | source:<channelPartyId> | client:<id> | jobtype:).
 * An owner dividend is just a default-scoped term that applies on every job.
 *
 * The FORMULA (basis), not just the rate, is per-beneficiary and changeable going
 * forward; resolution is effective-dated (asOf = the job date) so a past job
 * settles on its own-era terms after a later renegotiation.
 */

import { isEffectiveOn, parseAppliesTo, type DealTermLike } from "./rules.js";
import type { ProfitShareBasis } from "./enums.js";
import { round2 } from "./money.js";

const createdAtMs = (v: string | Date | null | undefined): number =>
  v == null ? 0 : v instanceof Date ? v.getTime() : new Date(v).getTime();

export interface ProfitShareTermContext {
  toPartyId: string; // the beneficiary
  sourcePartyId?: string | null; // the job's source (channel/partner/vendor)
  clientPartyId?: string | null;
  jobType?: string | null;
  asOf: string; // 'YYYY-MM-DD'
}

/**
 * Resolve a beneficiary's winning profit_share term by precedence. Candidates are
 * deal_terms with term_type='profit_share' and to_party_id = the beneficiary. A
 * client-scoped term (4) beats a source-scoped (3) beats a job-type (2) beats a
 * default (1); ties break to the latest effective_from, then created_at. Returns
 * null when no effective term applies to this job's context.
 *
 * Kept separate from resolveDealTerm because profit_share keys on to_party_id
 * alone (from_party_id is always NULL = business), not on a from→to pair.
 */
export function resolveProfitShareTerm(
  candidates: DealTermLike[],
  ctx: ProfitShareTermContext,
): DealTermLike | null {
  let best: DealTermLike | null = null;
  let bestScore = -1;

  for (const c of candidates) {
    if (c.termType !== "profit_share") continue;
    if (c.toPartyId !== ctx.toPartyId) continue;
    if (!isEffectiveOn(c, ctx.asOf)) continue;

    const at = parseAppliesTo(c.appliesTo);
    let appliesScore: number;
    if (at.kind === "client") {
      if (!ctx.clientPartyId || at.id !== ctx.clientPartyId) continue;
      appliesScore = 4;
    } else if (at.kind === "source") {
      if (!ctx.sourcePartyId || at.id !== ctx.sourcePartyId) continue;
      appliesScore = 3;
    } else if (at.kind === "jobtype") {
      if (!ctx.jobType || at.value !== ctx.jobType) continue;
      appliesScore = 2;
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

export interface ProfitShareJobInput {
  workItemId: string;
  jobDate: string; // 'YYYY-MM-DD' — the as-of date for term resolution
  revenue: number; // Σ legs from the source (the top client price)
  writerCost: number; // Σ legs to the doer (the writer payment)
  net?: number | null; // override for pct_of_net; defaults to revenue − writerCost
  channelEarnings?: number | null; // override for pct_of_channel; defaults to this job's post-writer margin
  sourcePartyId: string | null;
  clientPartyId?: string | null;
  jobType?: string | null;
}

export interface ProfitShareCut {
  toPartyId: string;
  termId: string;
  basis: ProfitShareBasis;
  rate: number; // the pct, or the fixed amount
  base: number; // the resolved base the rate applied to (the fixed amount for 'fixed')
  amount: number;
}

export interface ProfitShareResult {
  pool: number; // the divisible pool = post-writer margin (revenue − writerCost)
  cuts: ProfitShareCut[];
  residual: number; // pool − Σ cuts (belongs to the business / channel controller)
  overAllocated: boolean; // Σ cuts > pool — surfaced, never silently clamped
}

/** The base a given basis applies its rate to. Returns null for an unknown basis. */
function baseFor(basis: string, job: ProfitShareJobInput): number | null {
  const afterWriter = round2(job.revenue - job.writerCost);
  switch (basis) {
    case "pct_of_net":
      return job.net != null && Number.isFinite(job.net) ? round2(job.net) : afterWriter;
    case "pct_after_writer":
      return afterWriter;
    case "pct_of_channel":
      return job.channelEarnings != null && Number.isFinite(job.channelEarnings)
        ? round2(job.channelEarnings)
        : afterWriter;
    case "fixed":
      return null; // the amount is the value itself, not rate × base
    default:
      return null;
  }
}

/**
 * Divide a job's profit pool among N sharers per their effective profit_share
 * terms. Each sharer's cut = (basis='fixed' ? value : round2(base × value%)).
 * Sharers with no resolvable effective term contribute no cut. The residual
 * (pool − Σ cuts) belongs to the business (or the channel's controller, for
 * display). overAllocated flags Σ cuts > pool so the caller can warn — we never
 * silently clamp a configured rate. Pure: no DB, no leg reads.
 */
export function deriveProfitShares(
  job: ProfitShareJobInput,
  sharers: Array<{ toPartyId: string; terms: DealTermLike[] }>,
): ProfitShareResult {
  const pool = round2(job.revenue - job.writerCost);
  const cuts: ProfitShareCut[] = [];

  for (const sharer of sharers) {
    const term = resolveProfitShareTerm(sharer.terms, {
      toPartyId: sharer.toPartyId,
      sourcePartyId: job.sourcePartyId,
      clientPartyId: job.clientPartyId,
      jobType: job.jobType,
      asOf: job.jobDate,
    });
    if (!term) continue;

    const rate = Number(term.value);
    if (!Number.isFinite(rate)) continue;
    const basis = (term.basis ?? "") as ProfitShareBasis;

    let amount: number;
    let base: number;
    if (basis === "fixed") {
      base = round2(rate);
      amount = round2(rate);
    } else {
      const b = baseFor(basis, job);
      if (b == null) continue; // unknown basis → no silent 0; skip (caller can flag)
      base = b;
      amount = round2((b * rate) / 100);
    }

    cuts.push({ toPartyId: sharer.toPartyId, termId: term.id, basis, rate, base, amount });
  }

  const allocated = round2(cuts.reduce((sum, c) => sum + c.amount, 0));
  const residual = round2(pool - allocated);
  return { pool, cuts, residual, overAllocated: allocated > pool + 1e-9 };
}
