/**
 * The ONE rollup-period resolver for the PF planner. The account's chosen period
 * (week | month | custom N days) is turned into explicit [start, end) date
 * boundaries here, and this same resolver feeds the overview KPIs, the charts, AND
 * the anomaly comparison — so the chosen period is identical everywhere (the
 * explicit requirement). Boundaries are anchored to the DB's `current_date`
 * (passed in as `baseDate`) so JS date math never drifts from SQL.
 */
export type RollupKind = "week" | "month" | "custom";

export interface PeriodPrefs {
  rollupPeriod: RollupKind;
  rollupCustomDays: number;
}

/** A half-open date window [start, end) with a stable key + short axis label. */
export interface Bucket {
  key: string;
  start: string; // yyyy-mm-dd inclusive
  end: string; // yyyy-mm-dd exclusive
  label: string; // short label for a chart axis
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parse = (base: string): Date => new Date(`${base.slice(0, 10)}T00:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
};
const startOfMonth = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonths = (d: Date, n: number): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
/** Monday-anchored week start (ISO-ish, no week-number edge cases). */
const mondayOf = (d: Date): Date => addDays(d, -((d.getUTCDay() + 6) % 7));

const ddmm = (d: Date): string => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const customDays = (prefs: PeriodPrefs): number => Math.min(Math.max(Math.trunc(prefs.rollupCustomDays) || 30, 1), 366);

/** Build the bucket for the `stepsBack`-th period before the current one (0 = current). */
function bucketAt(prefs: PeriodPrefs, baseDate: string, stepsBack: number): Bucket {
  const base = parse(baseDate);
  if (prefs.rollupPeriod === "month") {
    const s = addMonths(startOfMonth(base), -stepsBack);
    const e = addMonths(s, 1);
    return { key: `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}`, start: iso(s), end: iso(e), label: MONTHS[s.getUTCMonth()]! };
  }
  if (prefs.rollupPeriod === "week") {
    const s = addDays(mondayOf(base), -7 * stepsBack);
    const e = addDays(s, 7);
    return { key: `week-${iso(s)}`, start: iso(s), end: iso(e), label: ddmm(s) };
  }
  // custom: rolling window of N days ending today; previous windows step back N days.
  const n = customDays(prefs);
  const e = addDays(addDays(base, 1), -n * stepsBack);
  const s = addDays(e, -n);
  return { key: `days-${iso(s)}`, start: iso(s), end: iso(e), label: ddmm(s) };
}

/** The current period window for the account's chosen rollup. */
export function currentPeriod(prefs: PeriodPrefs, baseDate: string): Bucket {
  return bucketAt(prefs, baseDate, 0);
}

/** `count` consecutive periods ending with the current one, oldest → newest (for trends). */
export function recentBuckets(prefs: PeriodPrefs, baseDate: string, count: number): Bucket[] {
  const out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(bucketAt(prefs, baseDate, i));
  return out;
}

/** A human label for the whole rollup (used in emails / headers). */
export function rollupLabel(prefs: PeriodPrefs): string {
  if (prefs.rollupPeriod === "week") return "week";
  if (prefs.rollupPeriod === "month") return "month";
  return `${customDays(prefs)} days`;
}
