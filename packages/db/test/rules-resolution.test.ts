import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEffectiveOn,
  parseAppliesTo,
  resolveCompRule,
  resolveDealTerm,
  type CompRuleLike,
  type DealTermLike,
} from "@business-os/shared";

/**
 * Module 3 — PURE rules-engine unit tests (no DB). The cheapest, most thorough
 * place to pin PRECEDENCE + EFFECTIVE-DATING (DESIGN_SPEC §3.4–3.5, CLAUDE.md
 * §3.5). The load-bearing guarantee under test: **a PAST job settles on PAST
 * terms even after a later renegotiation.** Run via the db package's runner
 * (node --import tsx --test) — no new framework introduced.
 */

// Party ids for the relationship under test (source → doer).
const FROM = "11111111-1111-4111-8111-111111111111";
const TO = "22222222-2222-4222-8222-222222222222";
const CLIENT_X = "33333333-3333-4333-8333-333333333333";
const CLIENT_Y = "44444444-4444-4444-8444-444444444444";
const OTHER_FROM = "55555555-5555-4555-8555-555555555555";

const baseTerm = (over: Partial<DealTermLike>): DealTermLike => ({
  id: over.id ?? "t",
  fromPartyId: FROM,
  toPartyId: TO,
  appliesTo: "default",
  termType: "per_word",
  value: "1.0",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...over,
});

// ─── isEffectiveOn — half-open window [from, to) ───────────────────────────────

describe("isEffectiveOn — half-open window [effectiveFrom, effectiveTo)", () => {
  const w = { effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01" };

  it("asOf == effectiveFrom → true (inclusive lower bound)", () => {
    assert.equal(isEffectiveOn(w, "2026-01-01"), true);
  });

  it("asOf == effectiveTo → FALSE (exclusive upper bound)", () => {
    assert.equal(isEffectiveOn(w, "2026-06-01"), false);
  });

  it("asOf strictly inside the window → true", () => {
    assert.equal(isEffectiveOn(w, "2026-03-15"), true);
  });

  it("asOf before effectiveFrom → false", () => {
    assert.equal(isEffectiveOn(w, "2025-12-31"), false);
  });

  it("effectiveTo == null → open-ended (any asOf >= from is true)", () => {
    const open = { effectiveFrom: "2026-01-01", effectiveTo: null };
    assert.equal(isEffectiveOn(open, "2026-01-01"), true);
    assert.equal(isEffectiveOn(open, "2099-01-01"), true);
    assert.equal(isEffectiveOn(open, "2025-12-31"), false);
  });

  it("a day before the day after to is still excluded one day after (no overlap at boundary)", () => {
    // adjacency: [..,2026-06-01) then [2026-06-01,..) — 2026-06-01 belongs ONLY to the later window.
    assert.equal(isEffectiveOn({ effectiveFrom: "2026-06-01", effectiveTo: null }, "2026-06-01"), true);
  });
});

// ─── parseAppliesTo — 'default' | 'client:<uuid>' | 'jobtype:<x>' ──────────────

describe("parseAppliesTo — SCHEMA text convention", () => {
  it("'default' → {default}", () => {
    assert.deepEqual(parseAppliesTo("default"), { kind: "default" });
  });
  it("'client:<uuid>' → {client,id}", () => {
    assert.deepEqual(parseAppliesTo(`client:${CLIENT_X}`), { kind: "client", id: CLIENT_X });
  });
  it("'jobtype:<x>' → {jobtype,value}", () => {
    assert.deepEqual(parseAppliesTo("jobtype:essay"), { kind: "jobtype", value: "essay" });
  });
  it("'source:<uuid>' → {source,id} (module 17 source routing)", () => {
    assert.deepEqual(parseAppliesTo(`source:${CLIENT_X}`), { kind: "source", id: CLIENT_X });
  });
  it("an unknown prefix falls back to default (fail-safe to least-specific)", () => {
    assert.deepEqual(parseAppliesTo("garbage"), { kind: "default" });
  });
});

// ─── SOURCE ROUTING (module 17) — client > source > jobtype > default ──────────

describe("resolveDealTerm — source-scoped precedence (client 4 > source 3 > jobtype 2 > default 1)", () => {
  const asOf = "2026-03-15";
  const SOURCE = "88888888-8888-4888-8888-888888888888"; // a channel/partner party
  const def = baseTerm({ id: "def", appliesTo: "default", value: "10" });
  const jt = baseTerm({ id: "jt", appliesTo: "jobtype:essay", value: "20" });
  const src = baseTerm({ id: "src", appliesTo: `source:${SOURCE}`, value: "25" });
  const cli = baseTerm({ id: "cli", appliesTo: `client:${CLIENT_X}`, value: "30" });
  const ctx = { fromPartyId: FROM, toPartyId: TO, termType: "per_word" as const, asOf };

  it("a matching source beats a jobtype and a default", () => {
    const r = resolveDealTerm([def, jt, src], { ...ctx, sourcePartyId: SOURCE, jobType: "essay" });
    assert.equal(r?.id, "src");
  });

  it("a client rule still beats a matching source (client is most specific)", () => {
    const r = resolveDealTerm([src, cli], { ...ctx, sourcePartyId: SOURCE, clientPartyId: CLIENT_X });
    assert.equal(r?.id, "cli");
  });

  it("a non-matching source never wins; falls through to jobtype/default", () => {
    const r = resolveDealTerm([def, jt, src], { ...ctx, sourcePartyId: "99999999-9999-4999-8999-999999999999", jobType: "essay" });
    assert.equal(r?.id, "jt", "a source rule for another source must not leak");
  });

  it("a source rule is ignored when the ctx has no sourcePartyId", () => {
    const r = resolveDealTerm([def, src], { ...ctx });
    assert.equal(r?.id, "def");
  });
});

// ─── EFFECTIVE-DATING — the past-settles-on-past guarantee ─────────────────────

describe("resolveDealTerm — effective-dating (PAST job settles on PAST terms)", () => {
  // Two versions of the SAME default rule: v1 1.0 [2026-01-01,2026-06-01), v2 1.5 [2026-06-01,null).
  const v1 = baseTerm({ id: "v1", value: "1.0", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01" });
  const v2 = baseTerm({ id: "v2", value: "1.5", effectiveFrom: "2026-06-01", effectiveTo: null });
  const candidates = [v1, v2];
  const ctx = { fromPartyId: FROM, toPartyId: TO, termType: "per_word" as const };

  it("asOf 2026-03-15 (before renegotiation) → v1 value 1.0", () => {
    const r = resolveDealTerm(candidates, { ...ctx, asOf: "2026-03-15" });
    assert.equal(r?.id, "v1");
    assert.equal(r?.value, "1.0");
  });

  it("asOf 2026-07-01 (after renegotiation) → v2 value 1.5", () => {
    const r = resolveDealTerm(candidates, { ...ctx, asOf: "2026-07-01" });
    assert.equal(r?.id, "v2");
    assert.equal(r?.value, "1.5");
  });

  it("asOf 2025-12-01 (before any version) → null (no fabricated term)", () => {
    const r = resolveDealTerm(candidates, { ...ctx, asOf: "2025-12-01" });
    assert.equal(r, null);
  });

  it("asOf exactly on the cutover 2026-06-01 → v2 (boundary belongs to the new terms)", () => {
    const r = resolveDealTerm(candidates, { ...ctx, asOf: "2026-06-01" });
    assert.equal(r?.id, "v2", "the half-open [from,to) boundary settles on the NEW version");
  });

  it("asOf the last day of v1 (2026-05-31) → still v1 (old terms hold to the very end)", () => {
    const r = resolveDealTerm(candidates, { ...ctx, asOf: "2026-05-31" });
    assert.equal(r?.id, "v1");
  });
});

// ─── PRECEDENCE — most-specific → default; specific-pair beats global ─────────

describe("resolveDealTerm — precedence (most-specific wins)", () => {
  const asOf = "2026-03-15";
  // All effective, same pair, same termType; differ only in applies_to.
  const def = baseTerm({ id: "def", appliesTo: "default", value: "10" });
  const jt = baseTerm({ id: "jt", appliesTo: "jobtype:essay", value: "20" });
  const cli = baseTerm({ id: "cli", appliesTo: `client:${CLIENT_X}`, value: "30" });
  const candidates = [def, jt, cli];
  const ctx = { fromPartyId: FROM, toPartyId: TO, termType: "per_word" as const, asOf };

  it("with a matching client → the client rule wins (most specific)", () => {
    const r = resolveDealTerm(candidates, { ...ctx, clientPartyId: CLIENT_X, jobType: "essay" });
    assert.equal(r?.id, "cli");
  });

  it("with a job type but no client → the jobtype rule wins", () => {
    const r = resolveDealTerm(candidates, { ...ctx, jobType: "essay" });
    assert.equal(r?.id, "jt");
  });

  it("with neither client nor jobtype → the default rule wins", () => {
    const r = resolveDealTerm(candidates, { ...ctx });
    assert.equal(r?.id, "def");
  });

  it("a non-matching client never wins; falls through to jobtype/default", () => {
    // ctx client = CLIENT_Y but the only client rule is for CLIENT_X → must NOT pick 'cli'.
    const r = resolveDealTerm(candidates, { ...ctx, clientPartyId: CLIENT_Y, jobType: "essay" });
    assert.equal(r?.id, "jt", "an unrelated client rule must not leak to a different client");
  });

  it("a non-matching jobtype never wins; falls to default", () => {
    const r = resolveDealTerm(candidates, { ...ctx, jobType: "report" });
    assert.equal(r?.id, "def");
  });

  it("returns null when there is no applicable rule at all", () => {
    const r = resolveDealTerm([], { ...ctx });
    assert.equal(r, null);
  });
});

describe("resolveDealTerm — specific party-pair beats a global (null,null) rule", () => {
  const asOf = "2026-03-15";
  const globalDefault = baseTerm({
    id: "global",
    fromPartyId: null,
    toPartyId: null,
    appliesTo: "default",
    value: "100",
  });
  const specificPair = baseTerm({ id: "pair", appliesTo: "default", value: "200" });
  const ctx = { fromPartyId: FROM, toPartyId: TO, termType: "per_word" as const, asOf };

  it("the specific (from,to) pair beats the global null pair at the same applies_to", () => {
    const r = resolveDealTerm([globalDefault, specificPair], ctx);
    assert.equal(r?.id, "pair");
  });

  it("a global rule still applies when no specific pair exists", () => {
    const r = resolveDealTerm([globalDefault], ctx);
    assert.equal(r?.id, "global");
  });

  it("a rule for a DIFFERENT pair never wins (and isn't treated as global)", () => {
    const otherPair = baseTerm({ id: "other", fromPartyId: OTHER_FROM, toPartyId: TO, value: "999" });
    const r = resolveDealTerm([otherPair, globalDefault], ctx);
    assert.equal(r?.id, "global", "a foreign-pair rule must be skipped, not chosen");
  });

  it("a specific-pair client rule beats a global client rule (10+3 > 0+3)", () => {
    const globalClient = baseTerm({
      id: "gc",
      fromPartyId: null,
      toPartyId: null,
      appliesTo: `client:${CLIENT_X}`,
      value: "1",
    });
    const pairClient = baseTerm({ id: "pc", appliesTo: `client:${CLIENT_X}`, value: "2" });
    const r = resolveDealTerm([globalClient, pairClient], { ...ctx, clientPartyId: CLIENT_X });
    assert.equal(r?.id, "pc");
  });
});

describe("resolveDealTerm — an expired/future rule never wins", () => {
  const ctx = { fromPartyId: FROM, toPartyId: TO, termType: "per_word" as const };

  it("an expired specific rule loses to a still-effective default", () => {
    const expiredSpecific = baseTerm({
      id: "exp",
      appliesTo: `client:${CLIENT_X}`,
      value: "99",
      effectiveFrom: "2025-01-01",
      effectiveTo: "2025-12-31",
    });
    const liveDefault = baseTerm({ id: "live", appliesTo: "default", value: "5" });
    const r = resolveDealTerm([expiredSpecific, liveDefault], {
      ...ctx,
      clientPartyId: CLIENT_X,
      asOf: "2026-03-15",
    });
    assert.equal(r?.id, "live", "an expired more-specific rule must not win over a live default");
  });

  it("a not-yet-effective rule is ignored", () => {
    const future = baseTerm({ id: "fut", value: "9", effectiveFrom: "2027-01-01" });
    const r = resolveDealTerm([future], { ...ctx, asOf: "2026-03-15" });
    assert.equal(r, null);
  });
});

describe("resolveDealTerm — tie-break = latest effective_from", () => {
  const ctx = { fromPartyId: FROM, toPartyId: TO, termType: "per_word" as const, asOf: "2026-08-01" };

  it("two same-specificity effective rules → the one with the later effective_from wins", () => {
    // Both default, both currently effective; later effective_from is the live version.
    const older = baseTerm({ id: "older", value: "1", effectiveFrom: "2026-01-01", effectiveTo: null, createdAt: "2026-01-01T00:00:00Z" });
    const newer = baseTerm({ id: "newer", value: "2", effectiveFrom: "2026-07-01", effectiveTo: null, createdAt: "2026-07-01T00:00:00Z" });
    const r = resolveDealTerm([older, newer], ctx);
    assert.equal(r?.id, "newer");
  });

  it("equal effective_from → tie-break to latest created_at", () => {
    const a = baseTerm({ id: "a", value: "1", effectiveFrom: "2026-07-01", createdAt: "2026-07-01T00:00:00Z" });
    const b = baseTerm({ id: "b", value: "2", effectiveFrom: "2026-07-01", createdAt: "2026-07-02T00:00:00Z" });
    const r = resolveDealTerm([a, b], ctx);
    assert.equal(r?.id, "b");
  });
});

describe("resolveDealTerm — term_type is a hard filter", () => {
  it("a different term_type is never returned for the requested type", () => {
    const split = baseTerm({ id: "split", termType: "split_pct", value: "50" });
    const r = resolveDealTerm([split], {
      fromPartyId: FROM,
      toPartyId: TO,
      termType: "per_word",
      asOf: "2026-03-15",
    });
    assert.equal(r, null, "split_pct must not satisfy a per_word query");
  });
});

// ─── resolveCompRule — party-specific beats role-level; basis + dating ────────

const baseComp = (over: Partial<CompRuleLike>): CompRuleLike => ({
  id: over.id ?? "c",
  partyId: TO,
  roleId: null,
  basis: "per_word",
  rate: "0.5",
  costBearer: "writer",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...over,
});

const ROLE = "66666666-6666-4666-8666-666666666666";

describe("resolveCompRule — party-specific beats role-level", () => {
  const asOf = "2026-03-15";

  it("a party-specific rule wins over a role-level rule for the same party", () => {
    const partyRule = baseComp({ id: "party", partyId: TO, roleId: null, rate: "1.0" });
    const roleRule = baseComp({ id: "role", partyId: null, roleId: ROLE, rate: "0.5" });
    const r = resolveCompRule([roleRule, partyRule], { partyId: TO, roleId: ROLE, asOf });
    assert.equal(r?.id, "party");
  });

  it("falls back to the role-level rule when no party-specific rule exists", () => {
    const roleRule = baseComp({ id: "role", partyId: null, roleId: ROLE, rate: "0.5" });
    const r = resolveCompRule([roleRule], { partyId: TO, roleId: ROLE, asOf });
    assert.equal(r?.id, "role");
  });

  it("a role rule for a DIFFERENT role never wins", () => {
    const OTHER_ROLE = "77777777-7777-4777-8777-777777777777";
    const roleRule = baseComp({ id: "role", partyId: null, roleId: OTHER_ROLE });
    const r = resolveCompRule([roleRule], { partyId: TO, roleId: ROLE, asOf });
    assert.equal(r, null);
  });
});

describe("resolveCompRule — basis filter + effective dating", () => {
  const asOf = "2026-03-15";

  it("the basis filter excludes rules of another basis", () => {
    const perWord = baseComp({ id: "pw", basis: "per_word" });
    const monthly = baseComp({ id: "mo", basis: "monthly" });
    const r = resolveCompRule([perWord, monthly], { partyId: TO, basis: "monthly", asOf });
    assert.equal(r?.id, "mo");
  });

  it("with no basis filter, any effective party rule may resolve", () => {
    const perWord = baseComp({ id: "pw", basis: "per_word" });
    const r = resolveCompRule([perWord], { partyId: TO, asOf });
    assert.equal(r?.id, "pw");
  });

  it("an expired comp rule never wins (PAST/dating)", () => {
    const expired = baseComp({ id: "exp", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" });
    const live = baseComp({ id: "live", effectiveFrom: "2026-01-01", effectiveTo: null, rate: "2.0" });
    const r = resolveCompRule([expired, live], { partyId: TO, asOf });
    assert.equal(r?.id, "live");
  });

  it("a comp rule effective in the PAST settles a PAST asOf (and a later one settles later)", () => {
    const v1 = baseComp({ id: "v1", rate: "0.5", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01" });
    const v2 = baseComp({ id: "v2", rate: "0.8", effectiveFrom: "2026-06-01", effectiveTo: null });
    assert.equal(resolveCompRule([v1, v2], { partyId: TO, asOf: "2026-03-15" })?.id, "v1");
    assert.equal(resolveCompRule([v1, v2], { partyId: TO, asOf: "2026-07-01" })?.id, "v2");
  });

  it("returns null when neither party nor role matches", () => {
    const r = resolveCompRule([baseComp({ partyId: "nope" })], { partyId: TO, asOf });
    assert.equal(r, null);
  });
});
