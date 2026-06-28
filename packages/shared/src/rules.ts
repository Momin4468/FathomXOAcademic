/**
 * Effective-dated rule resolution (DESIGN_SPEC §3.4–3.5). Pure functions so the
 * precedence + effective-dating logic is unit-testable without a DB and reused
 * by the API (and later web/billing). Rules are never mutated; renegotiation
 * supersedes (a new version with a later effective_from). Resolution picks the
 * version whose window contains the as-of date, by specificity.
 *
 * Dates are ISO 'YYYY-MM-DD' strings (Postgres `date`), which compare correctly
 * lexicographically.
 */

export interface EffectiveDated {
  effectiveFrom: string; // 'YYYY-MM-DD'
  effectiveTo: string | null; // exclusive upper bound; null = open
}

/** Half-open window [effectiveFrom, effectiveTo) contains asOf. */
export function isEffectiveOn(rule: EffectiveDated, asOf: string): boolean {
  if (rule.effectiveFrom > asOf) return false;
  if (rule.effectiveTo !== null && asOf >= rule.effectiveTo) return false;
  return true;
}

export type AppliesTo =
  | { kind: "default" }
  | { kind: "client"; id: string }
  | { kind: "jobtype"; value: string };

/** Parse the SCHEMA text convention: 'default' | 'client:<uuid>' | 'jobtype:<x>'. */
export function parseAppliesTo(appliesTo: string): AppliesTo {
  if (appliesTo.startsWith("client:")) return { kind: "client", id: appliesTo.slice(7) };
  if (appliesTo.startsWith("jobtype:")) return { kind: "jobtype", value: appliesTo.slice(8) };
  return { kind: "default" };
}

export interface DealTermLike extends EffectiveDated {
  id: string;
  fromPartyId: string | null;
  toPartyId: string | null;
  appliesTo: string;
  termType: string;
  basis?: string | null; // referral_pct only: revenue | margin | fixed (0021)
  value: string;
  createdAt?: string | Date | null;
}

export interface DealTermContext {
  fromPartyId: string;
  toPartyId: string;
  termType: string;
  clientPartyId?: string | null;
  jobType?: string | null;
  asOf: string;
}

const createdAtMs = (v: string | Date | null | undefined): number =>
  v == null ? 0 : v instanceof Date ? v.getTime() : new Date(v).getTime();

/**
 * Resolve the winning deal term by precedence: specific party-pair beats global,
 * and applies_to client > jobtype > default. Ties break to the latest
 * effective_from, then latest created_at. Returns null when nothing applies.
 */
export function resolveDealTerm(
  candidates: DealTermLike[],
  ctx: DealTermContext,
): DealTermLike | null {
  let best: DealTermLike | null = null;
  let bestScore = -1;

  for (const c of candidates) {
    if (c.termType !== ctx.termType) continue;
    if (!isEffectiveOn(c, ctx.asOf)) continue;

    // Party-pair: exact match (specific) or fully-null (global); else skip.
    const pairSpecific = c.fromPartyId === ctx.fromPartyId && c.toPartyId === ctx.toPartyId;
    const pairGlobal = c.fromPartyId === null && c.toPartyId === null;
    if (!pairSpecific && !pairGlobal) continue;

    // applies_to must match the context (or be default); else skip.
    const at = parseAppliesTo(c.appliesTo);
    let appliesScore: number;
    if (at.kind === "client") {
      if (!ctx.clientPartyId || at.id !== ctx.clientPartyId) continue;
      appliesScore = 3;
    } else if (at.kind === "jobtype") {
      if (!ctx.jobType || at.value !== ctx.jobType) continue;
      appliesScore = 2;
    } else {
      appliesScore = 1;
    }

    const score = (pairSpecific ? 10 : 0) + appliesScore;
    if (
      score > bestScore ||
      (score === bestScore &&
        best !== null &&
        (c.effectiveFrom > best.effectiveFrom ||
          (c.effectiveFrom === best.effectiveFrom &&
            createdAtMs(c.createdAt) >= createdAtMs(best.createdAt))))
    ) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export interface CompRuleLike extends EffectiveDated {
  id: string;
  partyId: string | null;
  roleId: string | null;
  basis: string;
  rate: string | null;
  costBearer: string;
  createdAt?: string | Date | null;
}

export interface CompRuleContext {
  partyId?: string | null;
  roleId?: string | null;
  basis?: string | null;
  asOf: string;
}

/**
 * Resolve the winning comp rule: a party-specific rule beats a role-level rule.
 * Effective + (optional) basis filter; ties break to latest effective_from.
 */
export function resolveCompRule(
  candidates: CompRuleLike[],
  ctx: CompRuleContext,
): CompRuleLike | null {
  let best: CompRuleLike | null = null;
  let bestScore = -1;

  for (const c of candidates) {
    if (!isEffectiveOn(c, ctx.asOf)) continue;
    if (ctx.basis && c.basis !== ctx.basis) continue;

    const partySpecific = c.partyId !== null && c.partyId === ctx.partyId;
    const roleLevel = c.partyId === null && c.roleId !== null && c.roleId === ctx.roleId;
    if (!partySpecific && !roleLevel) continue;

    const score = partySpecific ? 10 : 1;
    if (
      score > bestScore ||
      (score === bestScore && best !== null && c.effectiveFrom > best.effectiveFrom)
    ) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
