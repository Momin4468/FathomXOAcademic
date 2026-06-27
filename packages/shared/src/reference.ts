/**
 * Canonical-reference normalization (DESIGN_SPEC §7, "fuzzy-in / canonical-out").
 * Collapses case/space/punctuation so spelling variants of the SAME token map to
 * one key: "ICT 701" / "ICT701" / "ICT  701" / "ict-701" -> "ict701".
 *
 * Genuinely different spellings (e.g. "701" vs "ICT701") are NOT unified here —
 * that's what ref_alias rows are for (each distinct normalized spelling points at
 * the same canonical entity).
 *
 * Used by the API on every alias write/lookup AND by the web type-ahead, so both
 * sides normalize identically.
 */
export function normalize(input: string): string {
  return input
    .normalize("NFKD") // split accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ""); // strip everything but [a-z0-9]
}
