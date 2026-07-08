/**
 * Billing money math (DESIGN_SPEC §6, SCHEMA §I). Pure functions so balances are
 * always DERIVED from allocation sums (never stored) and the two-way netting /
 * money-state logic is unit-testable without a DB.
 */
import type { MoneyState } from "./enums.js";
import { round2 } from "./money.js";

/** Sum a list of amounts (numeric strings or numbers; negatives = reversals). */
export function sumAmounts(amounts: Array<string | number | null | undefined>): number {
  return round2(amounts.reduce<number>((acc, a) => acc + Number(a ?? 0), 0));
}

/** Per-line client tracking: paid = Σ allocations (incl. reversals); due = amount − paid. */
export function lineBalance(
  amount: string | number,
  allocationAmounts: Array<string | number>,
): { amount: number; paid: number; due: number } {
  const amt = round2(Number(amount));
  const paid = sumAmounts(allocationAmounts);
  return { amount: amt, paid, due: round2(amt - paid) };
}

/**
 * A party's two-way position: earnings owed to them (legs to them) vs charges
 * they owe (party→business), each net of what's already settled.
 */
export function derivePosition(input: {
  earningsOwed: number;
  earningsPaid: number;
  chargesOwed: number;
  chargesPaid: number;
}): { earningsOutstanding: number; chargesOutstanding: number; net: number } {
  const earningsOutstanding = round2(input.earningsOwed - input.earningsPaid);
  const chargesOutstanding = round2(input.chargesOwed - input.chargesPaid);
  return {
    earningsOutstanding,
    chargesOutstanding,
    net: round2(earningsOutstanding - chargesOutstanding),
  };
}

/**
 * The money close (independent of work-state): unbilled → invoiced → partial →
 * settled, from the job's billed total and allocated total. `lineCount`
 * distinguishes a truly-unbilled job (no lines) from one whose lines net to ≤ 0
 * (fully credited by a discount line, P1 item 6) — the latter owes nothing, so
 * it is "settled", not "unbilled".
 */
export function deriveMoneyState(input: {
  billedTotal: number;
  allocatedTotal: number;
  lineCount?: number;
}): MoneyState {
  const billed = round2(input.billedTotal);
  const allocated = round2(input.allocatedTotal);
  const hasLines = (input.lineCount ?? 0) > 0;
  if (billed <= 0) return hasLines ? "settled" : "unbilled";
  if (allocated <= 0) return "invoiced";
  if (allocated < billed) return "partial";
  return "settled";
}
