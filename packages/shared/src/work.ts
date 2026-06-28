/**
 * Work/leg money math (DESIGN_SPEC §3, SCHEMA §I). Pure functions so the API,
 * tests, and (later) the web compute identically — and so that profit/margin is
 * always DERIVED here at read time, never stored in a column.
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** A line's amount = fixed_amount if set, else rate × count. Never stored. */
export function computeLineAmount(opts: {
  rate?: string | number | null;
  count?: number | null;
  fixedAmount?: string | number | null;
}): number {
  if (opts.fixedAmount != null && opts.fixedAmount !== "") {
    return round2(Number(opts.fixedAmount));
  }
  return round2(Number(opts.rate ?? 0) * Number(opts.count ?? 0));
}

export interface LegLike {
  fromPartyId: string | null;
  toPartyId: string | null;
  amount: string | number;
}

export interface MarginNode {
  partyId: string;
  inbound: number;
  outbound: number;
  margin: number;
}

/**
 * Margin at a node = inbound − outbound, computed ONLY from the legs the caller
 * can see (RLS already filtered them). A node is reported only when both its
 * inbound and outbound legs are visible — so a party gets their own node, a
 * SuperAdmin gets every node, and the client/writer ends (one-sided) get none.
 * This is the structural-opacity guarantee expressed as arithmetic.
 */
export interface JobPnlInput {
  revenue: number; // Σ legs from the client (nets to 0 after a client-reversal)
  writerCost: number; // Σ legs to writer-typed parties (both writers; net of reversals)
  clawback: number; // Σ adjustment charges on the job (recovery; reduces the loss)
  reworkCost: number; // recorded remediation cost
}

export interface JobPnl extends JobPnlInput {
  net: number;
  isLoss: boolean;
}

/**
 * Job-level P&L (DESIGN_SPEC §3, §6) — derived, never stored. After a fail/resit
 * a job can be a NET LOSS (writer cost > client revenue); this surfaces it
 * truthfully. net = revenue − writerCost + clawback − reworkCost; a negative net
 * is a loss. Mirrors derivePosition / deriveCheckPnl (pure, unit-testable).
 */
export function deriveJobPnl(input: JobPnlInput): JobPnl {
  const revenue = round2(input.revenue);
  const writerCost = round2(input.writerCost);
  const clawback = round2(input.clawback);
  const reworkCost = round2(input.reworkCost);
  const net = round2(revenue - writerCost + clawback - reworkCost);
  return { revenue, writerCost, clawback, reworkCost, net, isLoss: net < 0 };
}

export function deriveMargins(legs: LegLike[]): MarginNode[] {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const leg of legs) {
    const amt = Number(leg.amount);
    if (leg.toPartyId) inbound.set(leg.toPartyId, (inbound.get(leg.toPartyId) ?? 0) + amt);
    if (leg.fromPartyId) outbound.set(leg.fromPartyId, (outbound.get(leg.fromPartyId) ?? 0) + amt);
  }
  const nodes: MarginNode[] = [];
  for (const [partyId, inAmt] of inbound) {
    const outAmt = outbound.get(partyId);
    if (outAmt === undefined) continue; // one-sided (client/writer end) → no margin
    nodes.push({
      partyId,
      inbound: round2(inAmt),
      outbound: round2(outAmt),
      margin: round2(inAmt - outAmt),
    });
  }
  return nodes;
}
