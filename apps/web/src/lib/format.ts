// Re-export the shared date helpers so screens import one place (dd/mm/yyyy rule).
export { formatDate, formatDateTime, urgency } from "@business-os/shared";

/**
 * Format a money value, returning null when there's nothing to show. The API
 * redacts money the caller can't see, so "absent ⇒ null ⇒ render nothing" — we
 * never invent a 0 or a "—" placeholder that would imply a hidden figure.
 */
export function formatMoney(value: number | string | null | undefined, prefix = "৳"): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return null;
  // Finance convention (R7): ALWAYS 2 decimals (৳1,500 → ৳1,500.00).
  return `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Money-input helpers (R1 MoneyInput) ──────────────────────────────────────

/**
 * Sanitize a typed money string to a bare numeric string (digits, ONE dot, and an
 * optional leading minus). Strips currency symbols, separators, and stray chars —
 * so a pasted "৳1,500.50" becomes "1500.50". Emitted to the form as-is.
 */
export function sanitizeAmount(raw: string, allowNegative = false): string {
  const neg = allowNegative && raw.trim().startsWith("-");
  const digitsDot = raw.replace(/[^0-9.]/g, "");
  const [int, ...rest] = digitsDot.split(".");
  const body = rest.length ? `${int}.${rest.join("")}` : int;
  return neg ? `-${body}` : body;
}

/**
 * Format a numeric string for DISPLAY in a money input on blur: thousand
 * separators + fixed decimals (2 by default). "" stays "". A half-typed value that
 * isn't a number yet is returned unchanged (so mid-edit text isn't destroyed).
 */
export function displayAmount(raw: string | number | null | undefined, decimals = 2): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (Number.isNaN(n)) return typeof raw === "string" ? raw : "";
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
