/**
 * Timezone-aware date helpers (DESIGN_SPEC §8). Dependency-free: built on Intl.
 * Deadlines are stored as an absolute instant (due_at) + the IANA zone they were
 * set in (due_tz); urgency ("time left") is absolute; display is dd/mm/yyyy.
 */

/** Whether a string is a valid IANA timezone (reject hostile/typo'd input → 400). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset (localMinusUtc, ms) at a given instant — DST-correct. */
function zoneOffsetMs(tz: string, instantMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(instantMs)).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - instantMs;
}

/**
 * A wall-clock time in a named zone → the absolute UTC instant (ISO string).
 * Two-pass to resolve the offset across DST boundaries.
 */
export function zonedWallToInstant(date: string, time: string, tz: string): string {
  const hhmm = time.length === 5 ? `${time}:00` : time;
  const wallAsUtc = Date.parse(`${date}T${hhmm}Z`);
  if (Number.isNaN(wallAsUtc)) throw new Error(`Invalid date/time: ${date} ${time}`);
  let instant = wallAsUtc - zoneOffsetMs(tz, wallAsUtc);
  instant = wallAsUtc - zoneOffsetMs(tz, instant); // refine at the candidate instant
  return new Date(instant).toISOString();
}

/** An absolute instant → the wall-clock { date 'yyyy-mm-dd', time 'HH:mm' } in a zone. */
export function instantToZoned(iso: string, tz: string): { date: string; time: string } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}

function partsIn(iso: string, tz?: string) {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (tz) opts.timeZone = tz;
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", opts).formatToParts(d).map((p) => [p.type, p.value]));
}

/** dd/mm/yyyy (in `tz`, else the runtime/browser zone). */
export function formatDate(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "";
  const p = partsIn(iso, tz);
  return `${p.day}/${p.month}/${p.year}`;
}

/** dd/mm/yyyy HH:mm (in `tz`, else the runtime/browser zone). */
export function formatDateTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "";
  const p = partsIn(iso, tz);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.day}/${p.month}/${p.year} ${hour}:${p.minute}`;
}

export type UrgencyBucket = "overdue" | "soon" | "later" | "none";

/** Absolute "time left" + a bucket. `soon` = due within 24h. Pure (now injectable). */
export function urgency(
  dueAtIso: string | null | undefined,
  nowMs: number = Date.now(),
): { overdue: boolean; msLeft: number | null; bucket: UrgencyBucket } {
  if (!dueAtIso) return { overdue: false, msLeft: null, bucket: "none" };
  const msLeft = new Date(dueAtIso).getTime() - nowMs;
  if (msLeft < 0) return { overdue: true, msLeft, bucket: "overdue" };
  if (msLeft <= 24 * 60 * 60 * 1000) return { overdue: false, msLeft, bucket: "soon" };
  return { overdue: false, msLeft, bucket: "later" };
}
