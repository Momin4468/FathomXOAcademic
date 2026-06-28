/**
 * Reputation read-model (DESIGN_SPEC §8) — PURE so it's computed identically by
 * the API and tests, and so the score is always DERIVED from outcome rows at
 * read time, NEVER stored or hand-edited. "Treat as aggregate signal, noisy on
 * any single job" (§8). Mirrors deriveMargins / derivePosition / deriveSettlement.
 */

import { round2 } from "./money.js";

/** One recorded outcome (the fields reputation reads; others are display-only). */
export interface OutcomeLike {
  onTime?: boolean | null;
  daysLate?: number | null;
  revisionCount?: number | null;
  revisionFault?: string | null;
  grade?: string | null;
  complaint?: boolean | null;
  failed?: boolean | null;
  aiScore?: number | string | null;
  satisfaction?: string | null;
  reworkCost?: number | string | null;
  disputed?: boolean | null;
}

export interface Reputation {
  jobCount: number;
  onTime: { count: number; measured: number; rate: number | null };
  avgDaysLate: number | null;
  revisionRate: number | null; // avg revisions/job
  writerFaultRevisions: number; // jobs with ≥1 revision the writer caused
  complaint: { count: number; rate: number | null };
  failRate: number | null;
  avgAiScore: number | null;
  satisfaction: { high: number; neutral: number; low: number };
  gradedCount: number;
  totalReworkCost: number;
  disputedCount: number;
  /** A transparent 0–100 heuristic; a derived signal, not an authoritative score. */
  reliabilityScore: number | null;
}

const rate = (num: number, den: number): number | null => (den > 0 ? round2(num / den) : null);

/** Aggregate a writer's outcome rows into the derived reputation read-model. */
export function deriveReputation(outcomes: OutcomeLike[]): Reputation {
  const jobCount = outcomes.length;

  let onTimeYes = 0;
  let onTimeMeasured = 0;
  let daysLateSum = 0;
  let daysLateMeasured = 0;
  let revisionSum = 0;
  let writerFaultRevisions = 0;
  let complaintCount = 0;
  let failCount = 0;
  let aiSum = 0;
  let aiMeasured = 0;
  const satisfaction = { high: 0, neutral: 0, low: 0 };
  let gradedCount = 0;
  let reworkSum = 0;
  let disputedCount = 0;

  for (const o of outcomes) {
    if (o.onTime != null) {
      onTimeMeasured += 1;
      if (o.onTime) onTimeYes += 1;
    }
    if (o.daysLate != null) {
      daysLateMeasured += 1;
      daysLateSum += Number(o.daysLate);
    }
    const rev = Number(o.revisionCount ?? 0);
    revisionSum += Number.isFinite(rev) ? rev : 0;
    if (rev > 0 && o.revisionFault === "writer") writerFaultRevisions += 1;
    if (o.complaint) complaintCount += 1;
    if (o.failed) failCount += 1;
    if (o.aiScore != null && o.aiScore !== "") {
      const ai = Number(o.aiScore);
      if (Number.isFinite(ai)) {
        aiMeasured += 1;
        aiSum += ai;
      }
    }
    if (o.satisfaction === "high") satisfaction.high += 1;
    else if (o.satisfaction === "neutral") satisfaction.neutral += 1;
    else if (o.satisfaction === "low") satisfaction.low += 1;
    if (o.grade != null && o.grade !== "") gradedCount += 1;
    const rc = Number(o.reworkCost ?? 0);
    reworkSum += Number.isFinite(rc) ? rc : 0;
    if (o.disputed) disputedCount += 1;
  }

  const onTimeRate = rate(onTimeYes, onTimeMeasured);
  const complaintRate = rate(complaintCount, jobCount);
  const failRate = rate(failCount, jobCount);
  const writerFaultRate = rate(writerFaultRevisions, jobCount);

  // Reliability heuristic: start from on-time%, subtract penalties for the
  // writer's own faults. Bounded 0–100. Null until there's signal to read.
  let reliabilityScore: number | null = null;
  if (jobCount > 0) {
    const base = onTimeRate ?? 1; // no on-time signal → don't penalise on it
    const penalty =
      0.4 * (writerFaultRate ?? 0) + 0.4 * (complaintRate ?? 0) + 0.5 * (failRate ?? 0);
    reliabilityScore = round2(Math.max(0, Math.min(1, base - penalty)) * 100);
  }

  return {
    jobCount,
    onTime: { count: onTimeYes, measured: onTimeMeasured, rate: onTimeRate },
    avgDaysLate: daysLateMeasured > 0 ? round2(daysLateSum / daysLateMeasured) : null,
    revisionRate: jobCount > 0 ? round2(revisionSum / jobCount) : null,
    writerFaultRevisions,
    complaint: { count: complaintCount, rate: complaintRate },
    failRate,
    avgAiScore: aiMeasured > 0 ? round2(aiSum / aiMeasured) : null,
    satisfaction,
    gradedCount,
    totalReworkCost: round2(reworkSum),
    disputedCount,
    reliabilityScore,
  };
}
