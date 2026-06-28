/**
 * Custom-field logic (DESIGN_SPEC §2 #10, §8). Pure functions so the API, tests,
 * and web validate/apply identically. A custom field is admin-defined, typed, and
 * SCOPED; its value lives in a record's `custom_json` keyed by the def's id.
 */

import type { CustomFieldType } from "./enums.js";

export interface CustomFieldDefLike {
  id: string;
  targetEntity: string;
  fieldName: string;
  fieldType: string; // CustomFieldType
  optionsJson: unknown; // string[] for select
  scopeJson: Record<string, unknown> | null; // {} global, or attrs to match
  required: boolean;
  archivedAt?: string | Date | null;
}

/** A record's matchable scope attributes (client/uni/type), entity-specific. */
export type RecordScope = Record<string, string | null | undefined>;

const isActive = (d: CustomFieldDefLike): boolean => !d.archivedAt;

/**
 * Does a field apply to a record? `{}` scope = global; otherwise EVERY attribute
 * present in scope_json must equal the record's corresponding attribute. Archived
 * defs never apply.
 */
export function isFieldApplicable(def: CustomFieldDefLike, record: RecordScope): boolean {
  if (!isActive(def)) return false;
  const scope = (def.scopeJson ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(scope)) {
    if (v == null || v === "") continue; // an empty scope attr doesn't constrain
    if (record[k] !== v) return false;
  }
  return true;
}

const isEmpty = (v: unknown): boolean =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

export type ValueCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate a single value against a def's type + (for select) its options. Empty
 * is allowed here — required-ness is a separate, soft/gate concern. Pure; the API
 * maps `ok:false` to a 400.
 */
export function validateCustomValue(def: CustomFieldDefLike, value: unknown): ValueCheck {
  if (isEmpty(value)) return { ok: true };
  const t = def.fieldType as CustomFieldType;
  switch (t) {
    case "text":
      return typeof value === "string"
        ? { ok: true }
        : { ok: false, error: `${def.fieldName}: expected text` };
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true }
        : { ok: false, error: `${def.fieldName}: expected a number` };
    case "bool":
      return typeof value === "boolean"
        ? { ok: true }
        : { ok: false, error: `${def.fieldName}: expected true/false` };
    case "date":
      // Strict ISO date 'YYYY-MM-DD' (optionally a full ISO datetime) — not any
      // loosely-parseable string (Date.parse would accept "42").
      return typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value) &&
        !Number.isNaN(Date.parse(value))
        ? { ok: true }
        : { ok: false, error: `${def.fieldName}: expected a date (YYYY-MM-DD)` };
    case "select": {
      const opts = Array.isArray(def.optionsJson) ? (def.optionsJson as unknown[]) : [];
      return opts.includes(value)
        ? { ok: true }
        : { ok: false, error: `${def.fieldName}: not one of the allowed options` };
    }
    default:
      return { ok: false, error: `${def.fieldName}: unknown field type` };
  }
}

/**
 * The ids of applicable, required defs whose value is empty on this record — the
 * "incomplete" signal (soft at draft; the API hard-blocks it only at a gate).
 */
export function missingRequired(
  defs: CustomFieldDefLike[],
  customJson: Record<string, unknown> | null | undefined,
  record: RecordScope,
): string[] {
  const values = customJson ?? {};
  return defs
    .filter((d) => d.required && isFieldApplicable(d, record) && isEmpty(values[d.id]))
    .map((d) => d.id);
}
