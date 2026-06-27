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
  return `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
