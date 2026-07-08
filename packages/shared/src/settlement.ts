/**
 * Settlement math (DESIGN_SPEC §4.4, §3) — PURE so the API and tests compute
 * identically and the partner-visibility logic stays auditable. Nothing here
 * reads a private leg: it operates only on the SHARED pool rows the
 * settlement_legs() SECURITY DEFINER function already reduced (pool = the
 * downstream-node margin), the tenant-readable deal terms, and the dated
 * partner transfers.
 *
 * One formula for both term types (anchored to §3.1's worked examples): for the
 * inter-partner handoff leg from=upstream → to=downstream, the DOWNSTREAM holds
 * the pool and OWES the UPSTREAM `value%` of it.
 *   • split_pct=50 on Momin→Emon   → Emon owes Momin 50% of 2000 = 1000
 *   • commission_pct=20 on Emon→Momin → Momin owes Emon 20% of the pool
 */
import { resolveDealTerm, type DealTermLike } from "./rules.js";
import { round2 } from "./money.js";

export interface SettlementPoolRow {
  workItemId: string;
  jobDate: string; // 'YYYY-MM-DD' (the as-of date for term resolution)
  upstreamParty: string;
  downstreamParty: string;
  pool: number | string;
}

export interface SettlementTransferRow {
  fromPartyId: string;
  toPartyId: string;
  amount: number | string;
}

export interface SettlementResult {
  jobCount: number; // shared jobs with a resolvable split/commission term
  totalPool: number; // sum of the shared pools (split jobs only)
  accrual: { partyA: number; partyB: number }; // each partner's accrued share
  transfersNet: number; // net already transferred A→B (negative = B→A)
  /** Net position after transfers, from A's perspective + a friendly resolution. */
  net: { aMinusB: number; owedBy: string | null; owedTo: string | null; amount: number };
}

/**
 * @param pairs the two partner ids; A is the reference perspective.
 */
export function deriveSettlement(
  poolRows: SettlementPoolRow[],
  dealTerms: DealTermLike[],
  transfers: SettlementTransferRow[],
  pair: { partyA: string; partyB: string },
): SettlementResult {
  const { partyA, partyB } = pair;
  // Signed balance from A's perspective: positive ⇒ A is owed by B.
  let aOwed = 0;
  let totalPool = 0;
  let jobCount = 0;

  for (const row of poolRows) {
    // Only the two partners' jobs matter.
    const up = row.upstreamParty;
    const down = row.downstreamParty;
    const isPair =
      (up === partyA && down === partyB) || (up === partyB && down === partyA);
    if (!isPair) continue;

    // Resolve the split/commission rate on (upstream → downstream) as-of the job.
    const term =
      resolveTerm(dealTerms, up, down, "split_pct", row.jobDate) ??
      resolveTerm(dealTerms, up, down, "commission_pct", row.jobDate);
    if (!term) continue; // no settlement term ⇒ not a shared/splittable job

    const pool = Number(row.pool);
    if (!Number.isFinite(pool) || pool === 0) {
      jobCount += 1;
      continue;
    }
    const owedToUpstream = round2((pool * Number(term.value)) / 100);
    totalPool = round2(totalPool + pool);
    jobCount += 1;

    // Downstream holds the pool and owes the upstream `owedToUpstream`.
    // Convert to A's perspective: if upstream is A, A is owed (+); if A is the
    // downstream (the ower), A owes (−).
    if (up === partyA) aOwed = round2(aOwed + owedToUpstream);
    else aOwed = round2(aOwed - owedToUpstream);
  }

  const accrualA = aOwed > 0 ? aOwed : 0;
  const accrualB = aOwed < 0 ? -aOwed : 0;

  // Net the dated transfers. `aOwed` (+) means B owes A. `transfersNet` is the
  // signed cash A→B. A B→A payment (B paying down their debt to A) reduces what B
  // owes A toward zero; an A→B payment raises B's debt to A. So both combine by
  // ADDING the signed transfer to the accrued balance.
  let transfersNet = 0; // net cash transferred A→B (A→B positive, B→A negative)
  for (const t of transfers) {
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    if (t.fromPartyId === partyA && t.toPartyId === partyB) transfersNet = round2(transfersNet + amt);
    else if (t.fromPartyId === partyB && t.toPartyId === partyA) transfersNet = round2(transfersNet - amt);
  }

  // aMinusB > 0 ⇒ B owes A; < 0 ⇒ A owes B. A B→A payment (transfersNet −) nets
  // the debt down: e.g. B owes A 1000, B pays A 1000 → 1000 + (−1000) = 0.
  const aMinusB = round2(aOwed + transfersNet);
  let owedBy: string | null = null;
  let owedTo: string | null = null;
  if (aMinusB > 0) {
    owedBy = partyB;
    owedTo = partyA;
  } else if (aMinusB < 0) {
    owedBy = partyA;
    owedTo = partyB;
  }

  return {
    jobCount,
    totalPool,
    accrual: { partyA: accrualA, partyB: accrualB },
    transfersNet,
    net: { aMinusB, owedBy, owedTo, amount: Math.abs(aMinusB) },
  };
}

function resolveTerm(
  dealTerms: DealTermLike[],
  fromPartyId: string,
  toPartyId: string,
  termType: string,
  asOf: string,
): DealTermLike | null {
  return resolveDealTerm(dealTerms, { fromPartyId, toPartyId, termType, asOf });
}

export interface PartnerBalanceResult {
  accrued: number; // total profit-share accrued to the focal party
  received: number; // net settlement transfers received (business payouts)
  owed: number; // accrued − received: what the business still owes them (negative = overpaid)
}

/**
 * A focal party's running profit-share balance vs the business (P0 item 3):
 *   owed = (profit_share accrued to them) − (net settlement transfers received).
 * A transfer TO them (a payout) reduces what they're owed; a transfer FROM them
 * increases it; reversing transfers (negative amounts) net automatically. The
 * caller supplies ONLY the focal party's own accrual (from the caller-guarded
 * my_profit_share definer) and the transfers RLS-scoped to them — so this stays
 * §4.4-opaque: no other partner's figure is ever an input, and a default net
 * dividend arrives already aggregated. Generalises the pair-only deriveSettlement
 * to an arbitrary single party without touching the binary Momin↔Emon path.
 */
export function derivePartnerBalance(
  accrued: number,
  transfers: SettlementTransferRow[],
  focalParty: string,
): PartnerBalanceResult {
  let received = 0;
  for (const t of transfers) {
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    if (t.toPartyId === focalParty) received = round2(received + amt);
    else if (t.fromPartyId === focalParty) received = round2(received - amt);
  }
  const acc = round2(accrued);
  return { accrued: acc, received, owed: round2(acc - received) };
}
