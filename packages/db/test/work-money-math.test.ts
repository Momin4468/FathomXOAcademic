import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeLineAmount, deriveLineMargin, deriveMargins } from "@business-os/shared";

/**
 * Module 2 — PURE money-math unit tests (no DB). These pin the two functions the
 * API, tests, and web all share so that profit/margin is DERIVED identically and
 * NEVER fabricated (CLAUDE.md §3, SCHEMA §I). Run via the db package's test
 * runner (node --import tsx --test) to avoid introducing a new framework; the
 * functions live in @business-os/shared and are imported from its build.
 *
 * NOTE: these are not "stored profit" — they are read-time derivations.
 */

describe("deriveLineMargin (per-copy client amount − writer cost ÷ copies; P1 item 5)", () => {
  it("a profitable copy → positive margin, not flagged", () => {
    // producer total 3000 across 3 copies = 1000/copy; this copy billed 1500.
    const m = deriveLineMargin({ consumerAmount: 1500, producerTotalAmount: 3000, copies: 3 });
    assert.equal(m.margin, 500);
    assert.equal(m.negativeMargin, false);
  });

  it("a below-cost copy → negative margin, flagged", () => {
    // 3000/3 = 1000/copy; this copy billed only 800 → −200.
    const m = deriveLineMargin({ consumerAmount: 800, producerTotalAmount: 3000, copies: 3 });
    assert.equal(m.margin, -200);
    assert.equal(m.negativeMargin, true);
  });

  it("exactly at cost → zero margin, NOT flagged (negativeMargin is strictly < 0)", () => {
    const m = deriveLineMargin({ consumerAmount: 1000, producerTotalAmount: 3000, copies: 3 });
    assert.equal(m.margin, 0);
    assert.equal(m.negativeMargin, false);
  });

  it("copies = 1 (a single deliverable) uses the whole producer cost", () => {
    const m = deriveLineMargin({ consumerAmount: 5000, producerTotalAmount: 6000, copies: 1 });
    assert.equal(m.margin, -1000);
    assert.equal(m.negativeMargin, true);
  });

  it("copies = 0 falls back to the whole producer cost (no divide-by-zero)", () => {
    const m = deriveLineMargin({ consumerAmount: 100, producerTotalAmount: 400, copies: 0 });
    assert.equal(m.margin, -300);
  });
});

describe("computeLineAmount (line total = fixed OR rate×count, never stored)", () => {
  it("fixed_amount wins over rate×count when present", () => {
    assert.equal(computeLineAmount({ rate: 5, count: 100, fixedAmount: 2000 }), 2000);
  });

  it("fixed_amount of 0 is honoured (an explicit zero is not 'absent')", () => {
    // 0 is a real fixed amount; only null/undefined/"" mean "use rate×count".
    assert.equal(computeLineAmount({ rate: 5, count: 100, fixedAmount: 0 }), 0);
  });

  it("falls back to rate×count when fixed is null/undefined/empty", () => {
    assert.equal(computeLineAmount({ rate: 1.5, count: 4000 }), 6000);
    assert.equal(computeLineAmount({ rate: 1.5, count: 4000, fixedAmount: null }), 6000);
    assert.equal(computeLineAmount({ rate: 1.5, count: 4000, fixedAmount: "" }), 6000);
  });

  it("accepts string inputs (numeric columns come back as strings from pg)", () => {
    assert.equal(computeLineAmount({ rate: "0.5", count: 3000 }), 1500);
    assert.equal(computeLineAmount({ fixedAmount: "2500.50" }), 2500.5);
  });

  it("rounds to 2 dp (no binary-float drift)", () => {
    // 0.1 * 3 = 0.30000000000000004 in IEEE754 → must round to 0.3.
    assert.equal(computeLineAmount({ rate: 0.1, count: 3 }), 0.3);
    // 1010 * 0.335 = 338.35 (a classic rounding trap)
    assert.equal(computeLineAmount({ rate: 0.335, count: 1010 }), 338.35);
  });

  it("missing rate/count default to 0 (empty state, no throw)", () => {
    assert.equal(computeLineAmount({}), 0);
    assert.equal(computeLineAmount({ rate: 5 }), 0); // no count
    assert.equal(computeLineAmount({ count: 5 }), 0); // no rate
  });
});

// Party ids for the chain Client -6000-> Momin -5000-> Emon -3000-> Writer.
const CLIENT = "client";
const MOMIN = "momin";
const EMON = "emon";
const WRITER = "writer";

const FULL_CHAIN = [
  { fromPartyId: CLIENT, toPartyId: MOMIN, amount: 6000 },
  { fromPartyId: MOMIN, toPartyId: EMON, amount: 5000 },
  { fromPartyId: EMON, toPartyId: WRITER, amount: 3000 },
];

describe("deriveMargins (margin = inbound − outbound, only for two-sided nodes)", () => {
  it("from the FULL chain, every intermediary node margin is returned", () => {
    const nodes = deriveMargins(FULL_CHAIN);
    const byParty = new Map(nodes.map((n) => [n.partyId, n]));
    assert.equal(nodes.length, 2, "only Momin & Emon are two-sided intermediaries");
    assert.deepEqual(
      { inbound: byParty.get(MOMIN)!.inbound, outbound: byParty.get(MOMIN)!.outbound, margin: byParty.get(MOMIN)!.margin },
      { inbound: 6000, outbound: 5000, margin: 1000 },
    );
    assert.deepEqual(
      { inbound: byParty.get(EMON)!.inbound, outbound: byParty.get(EMON)!.outbound, margin: byParty.get(EMON)!.margin },
      { inbound: 5000, outbound: 3000, margin: 2000 },
    );
  });

  it("the one-sided ends (client = pure source, writer = pure sink) yield NO node", () => {
    const nodes = deriveMargins(FULL_CHAIN);
    const parties = nodes.map((n) => n.partyId);
    assert.ok(!parties.includes(CLIENT), "client is outbound-only → no margin node");
    assert.ok(!parties.includes(WRITER), "writer is inbound-only → no margin node");
  });

  it("from a PARTIAL set (what Momin can see: legs 1 & 2) returns ONLY Momin's node", () => {
    // RLS gives Momin exactly legs Client→Momin and Momin→Emon.
    const mominsView = [FULL_CHAIN[0], FULL_CHAIN[1]];
    const nodes = deriveMargins(mominsView);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].partyId, MOMIN);
    assert.equal(nodes[0].margin, 1000);
  });

  it("from Emon's PARTIAL set (legs 2 & 3) returns ONLY Emon's node = 2000", () => {
    const emonsView = [FULL_CHAIN[1], FULL_CHAIN[2]];
    const nodes = deriveMargins(emonsView);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].partyId, EMON);
    assert.equal(nodes[0].margin, 2000);
  });

  it("CANNOT fabricate a node when only ONE of its legs is present (the leak guard)", () => {
    // If a viewer somehow only had the inbound leg into Momin (Client→Momin) but
    // NOT his outbound, no margin must be computable — otherwise outbound would be
    // assumed 0 and a fake 6000 'profit' invented.
    const onlyInbound = [FULL_CHAIN[0]]; // Client→Momin only
    assert.deepEqual(deriveMargins(onlyInbound), [], "one-sided → no node, never a fabricated margin");

    const onlyOutbound = [FULL_CHAIN[2]]; // Emon→Writer only
    assert.deepEqual(deriveMargins(onlyOutbound), [], "one-sided → no node");
  });

  it("the writer's lone visible leg (final) yields no node and no margin", () => {
    const writersView = [FULL_CHAIN[2]];
    assert.deepEqual(deriveMargins(writersView), []);
  });

  it("mixed-rate layers into the same node SUM before the margin is taken", () => {
    // Two inbound legs to Momin (e.g. base + extra-work layer) and one outbound.
    const layered = [
      { fromPartyId: CLIENT, toPartyId: MOMIN, amount: 6000 },
      { fromPartyId: CLIENT, toPartyId: MOMIN, amount: 1500 }, // extra layer
      { fromPartyId: MOMIN, toPartyId: EMON, amount: 5000 },
    ];
    const node = deriveMargins(layered).find((n) => n.partyId === MOMIN)!;
    assert.equal(node.inbound, 7500);
    assert.equal(node.outbound, 5000);
    assert.equal(node.margin, 2500);
  });

  it("handles string amounts (pg numeric) without concatenation bugs", () => {
    const node = deriveMargins([
      { fromPartyId: CLIENT, toPartyId: MOMIN, amount: "6000.00" },
      { fromPartyId: MOMIN, toPartyId: EMON, amount: "5000.00" },
    ])[0];
    assert.equal(node.margin, 1000);
  });

  it("empty leg set yields no nodes (empty state)", () => {
    assert.deepEqual(deriveMargins([]), []);
  });
});
