// Pure, money-free arithmetic on figures the API has ALREADY made visible — no
// derivation of hidden money happens here (these only operate on numbers the
// caller can already see). Unit-tested in apps/web/test/billing.test.ts.

/** A number rounded to 2dp, or 0 for anything non-finite. */
function n2(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/**
 * How much of a payment is still unallocated, given the amounts entered in the
 * current allocation session. Best-effort client-side guard; the server's cap
 * (over-allocation → 400) is the real authority.
 */
export function remainingToAllocate(
  paymentAmount: number | string | null | undefined,
  enteredAmounts: Array<number | string | null | undefined>,
): number {
  if (paymentAmount === null || paymentAmount === undefined || paymentAmount === "") return 0;
  const total = Number(paymentAmount);
  if (!Number.isFinite(total)) return 0;
  const used = enteredAmounts.reduce<number>((s, a) => {
    const v = Number(a);
    return s + (Number.isFinite(v) && v > 0 ? v : 0);
  }, 0);
  return n2(total - used);
}

/** Clamp an entered amount to [0, max]. Non-finite → 0. */
export function clampAmount(value: number | string | null | undefined, max: number): number {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return 0;
  if (Number.isFinite(max) && v > max) return n2(max);
  return n2(v);
}

/** Human label for a charge category enum (snake_case → Title Case). */
export function chargeCategoryLabel(category: string): string {
  const map: Record<string, string> = {
    platform_fee: "Platform fee",
    ai_check: "AI check",
    adjustment: "Adjustment",
    other: "Other",
  };
  return map[category] ?? category.replace(/_/g, " ");
}

/**
 * Label + tone for a two-way net position, chosen purely from the SIGN of the
 * net the API returned (the figure itself is rendered by <Money>, not here).
 */
export function netLabel(net: number | null | undefined): { text: string; tone: "green" | "red" | "gray" } {
  if (net === null || net === undefined || !Number.isFinite(Number(net))) {
    return { text: "—", tone: "gray" };
  }
  const v = Number(net);
  if (v > 0) return { text: "owed to this party", tone: "green" };
  if (v < 0) return { text: "owed to the business", tone: "red" };
  return { text: "settled", tone: "gray" };
}
