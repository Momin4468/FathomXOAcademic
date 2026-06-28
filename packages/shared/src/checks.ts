/**
 * Check-service money math (DESIGN_SPEC §8) — PURE, so the API and tests compute
 * identically and the unit's P&L is always DERIVED at read time, never stored.
 * "Are we making money on checks?" = revenue collected − allocated account cost
 * (the credit burn) − worker comp. AcademyCX shows as both capacity (credits
 * remaining) and cost (the weighted price of those credits).
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface TopupLike {
  credits: number | string;
  cost: number | string;
}

/** Weighted average cost per credit from real top-ups (Σcost / Σcredits). */
export function weightedCostPerCredit(topups: TopupLike[]): number {
  let credits = 0;
  let cost = 0;
  for (const t of topups) {
    credits += Number(t.credits) || 0;
    cost += Number(t.cost) || 0;
  }
  return credits > 0 ? round2(cost / credits) : 0;
}

/** A tool account's credit position: purchased − consumed = remaining. */
export function creditBalance(topups: TopupLike[], consumedCredits: number | string) {
  const purchased = topups.reduce((s, t) => s + (Number(t.credits) || 0), 0);
  const spend = topups.reduce((s, t) => s + (Number(t.cost) || 0), 0);
  const consumed = Number(consumedCredits) || 0;
  return {
    purchased: round2(purchased),
    consumed: round2(consumed),
    remaining: round2(purchased - consumed),
    spend: round2(spend),
    costPerCredit: weightedCostPerCredit(topups),
  };
}

export interface CheckPnlInput {
  revenue: number | string; // Σ confirmed amount_collected
  filesChecked: number | string;
  filesPaid: number | string;
  accountCost: number | string; // Σ (confirmed files_checked × cost-per-credit) per account
  workerComp: number | string; // Σ (confirmed files_checked × per-file comp rate)
}

export interface CheckPnl {
  revenue: number;
  accountCost: number;
  workerComp: number;
  net: number;
  filesChecked: number;
  filesPaid: number;
  marginPerCheck: number | null;
}

/** The unit's standalone P&L: revenue − account cost − worker comp. Derived. */
export function deriveCheckPnl(input: CheckPnlInput): CheckPnl {
  const revenue = round2(Number(input.revenue) || 0);
  const accountCost = round2(Number(input.accountCost) || 0);
  const workerComp = round2(Number(input.workerComp) || 0);
  const filesChecked = Number(input.filesChecked) || 0;
  const filesPaid = Number(input.filesPaid) || 0;
  const net = round2(revenue - accountCost - workerComp);
  return {
    revenue,
    accountCost,
    workerComp,
    net,
    filesChecked,
    filesPaid,
    marginPerCheck: filesChecked > 0 ? round2(net / filesChecked) : null,
  };
}
