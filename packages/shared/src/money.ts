/**
 * The ONE money-rounding helper (CLAUDE.md §3–4). Round to 2 decimal places with
 * an epsilon nudge so values that land on a half-cent (e.g. 1.005) round up
 * consistently — and so every module rounds money identically (no drift at
 * volume). Everything that touches money imports THIS, never a local copy or
 * `.toFixed` (which uses banker's rounding and diverges).
 */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
