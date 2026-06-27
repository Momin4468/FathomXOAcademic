import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDate,
  formatDateTime,
  instantToZoned,
  urgency,
  zonedWallToInstant,
} from "@business-os/shared";

/**
 * Module 6 — PURE timezone/urgency/format unit tests (no DB). These pin the
 * deadline contract (DESIGN_SPEC §8, CLAUDE.md §4 timezone correctness):
 *   • a deadline is stored as an absolute instant (due_at) computed from a
 *     wall-clock + IANA zone, and that conversion must be DST-correct;
 *   • display is dd/mm/yyyy [HH:mm];
 *   • urgency ("time left") is absolute and bucketed with an injectable now.
 * Run via the db package runner (node --import tsx --test); imported from the
 * @business-os/shared build so the API and web share one implementation.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("zonedWallToInstant — DST-correct wall-clock → absolute instant", () => {
  it("Sydney July (AEST, UTC+10, no DST): 17:00 local → 07:00Z", () => {
    // Southern-hemisphere winter — standard time, +10.
    assert.equal(
      zonedWallToInstant("2027-07-01", "17:00", "Australia/Sydney"),
      "2027-07-01T07:00:00.000Z",
    );
  });

  it("Sydney January (AEDT, UTC+11, DST active): 17:00 local → 06:00Z", () => {
    // Southern-hemisphere summer — DST on, +11. The SAME wall time yields a
    // DIFFERENT UTC instant than July: this is the whole point.
    assert.equal(
      zonedWallToInstant("2027-01-15", "17:00", "Australia/Sydney"),
      "2027-01-15T06:00:00.000Z",
    );
  });

  it("London January (GMT, UTC+0): 09:00 local → 09:00Z", () => {
    assert.equal(
      zonedWallToInstant("2027-01-15", "09:00", "Europe/London"),
      "2027-01-15T09:00:00.000Z",
    );
  });

  it("London July (BST, UTC+1): 09:00 local → 08:00Z", () => {
    // Northern-hemisphere summer — DST on, +1. Same wall time, different instant.
    assert.equal(
      zonedWallToInstant("2027-07-15", "09:00", "Europe/London"),
      "2027-07-15T08:00:00.000Z",
    );
  });

  it("UTC zone is identity (sanity)", () => {
    assert.equal(zonedWallToInstant("2026-06-05", "12:30", "UTC"), "2026-06-05T12:30:00.000Z");
  });

  it("accepts HH:mm:ss as well as HH:mm", () => {
    assert.equal(zonedWallToInstant("2027-07-01", "17:00:00", "Australia/Sydney"), "2027-07-01T07:00:00.000Z");
  });

  it("throws on a malformed date/time (fail clearly, not silently)", () => {
    assert.throws(() => zonedWallToInstant("not-a-date", "17:00", "UTC"), /Invalid date\/time/);
  });
});

describe("instantToZoned — round-trips zonedWallToInstant", () => {
  it("Sydney summer round-trip preserves the wall clock (DST in)", () => {
    const iso = zonedWallToInstant("2027-01-15", "17:00", "Australia/Sydney");
    assert.deepEqual(instantToZoned(iso, "Australia/Sydney"), { date: "2027-01-15", time: "17:00" });
  });

  it("Sydney winter round-trip preserves the wall clock (DST out)", () => {
    const iso = zonedWallToInstant("2027-07-01", "17:00", "Australia/Sydney");
    assert.deepEqual(instantToZoned(iso, "Australia/Sydney"), { date: "2027-07-01", time: "17:00" });
  });

  it("London BST round-trip", () => {
    const iso = zonedWallToInstant("2027-07-15", "09:00", "Europe/London");
    assert.deepEqual(instantToZoned(iso, "Europe/London"), { date: "2027-07-15", time: "09:00" });
  });

  it("the SAME instant shows different wall clocks in different zones", () => {
    const iso = "2027-07-01T07:00:00.000Z";
    assert.deepEqual(instantToZoned(iso, "Australia/Sydney"), { date: "2027-07-01", time: "17:00" });
    assert.deepEqual(instantToZoned(iso, "UTC"), { date: "2027-07-01", time: "07:00" });
  });
});

describe("formatDate / formatDateTime — dd/mm/yyyy", () => {
  it("formatDate renders dd/mm/yyyy in the given zone", () => {
    assert.equal(formatDate("2026-06-05T10:00:00.000Z", "UTC"), "05/06/2026");
  });

  it("formatDateTime renders dd/mm/yyyy HH:mm in the given zone", () => {
    assert.equal(formatDateTime("2026-06-05T10:00:00.000Z", "UTC"), "05/06/2026 10:00");
  });

  it("zone affects the rendered day (Sydney rolls to next day)", () => {
    // 23:30Z on the 5th is 09:30 on the 6th in Sydney (UTC+10 in July).
    assert.equal(formatDate("2026-07-05T23:30:00.000Z", "Australia/Sydney"), "06/07/2026");
    assert.equal(formatDateTime("2026-07-05T23:30:00.000Z", "Australia/Sydney"), "06/07/2026 09:30");
  });

  it("null / undefined / empty → '' (empty state, no throw)", () => {
    assert.equal(formatDate(null), "");
    assert.equal(formatDate(undefined), "");
    assert.equal(formatDate(""), "");
    assert.equal(formatDateTime(null), "");
  });
});

describe("urgency — absolute time-left + bucket (now injected for determinism)", () => {
  const NOW = Date.parse("2026-06-28T12:00:00.000Z");

  it("a past due → overdue", () => {
    const u = urgency("2026-06-27T12:00:00.000Z", NOW);
    assert.equal(u.bucket, "overdue");
    assert.equal(u.overdue, true);
    assert.equal(u.msLeft, -DAY);
  });

  it("within 24h → soon", () => {
    const u = urgency("2026-06-29T11:00:00.000Z", NOW); // 23h out
    assert.equal(u.bucket, "soon");
    assert.equal(u.overdue, false);
  });

  it("exactly 24h out → soon (boundary inclusive)", () => {
    const u = urgency("2026-06-29T12:00:00.000Z", NOW);
    assert.equal(u.bucket, "soon");
    assert.equal(u.msLeft, DAY);
  });

  it("far future → later", () => {
    const u = urgency("2026-07-15T12:00:00.000Z", NOW);
    assert.equal(u.bucket, "later");
    assert.equal(u.overdue, false);
  });

  it("no deadline → none", () => {
    assert.deepEqual(urgency(null, NOW), { overdue: false, msLeft: null, bucket: "none" });
    assert.deepEqual(urgency(undefined, NOW), { overdue: false, msLeft: null, bucket: "none" });
  });
});
