import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { api, waitForHealth } from "./helpers.js";

/**
 * P1 item 6 — first-class price-correction + discount line kind. Proves:
 *   • a 'discount' consumer line (negative amount) reduces the invoice due;
 *   • a negative amount on any OTHER line kind is rejected (400);
 *   • a fully-discounted job is money_state 'settled', not 'unbilled';
 *   • POST /work/:id/legs/reprice posts an append-only DELTA leg that nets a
 *     from→to pair to the new total (margins recompute), and can stamp a writer
 *     line's note (fee adjusted). Requires FEATURE_WORK + FEATURE_BILLING.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3259;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let sysToken = "";
let mominToken = "";
let clientPartyId = "";
let writerPartyId = "";
const createdWorkItemIds: string[] = [];
const createdPartyIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_WORK: "true", FEATURE_BILLING: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE);
}
const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });

async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, ORG, name, `{${type}}`]);
  createdPartyIds.push(id);
  return id;
}
async function createWorkItem(): Promise<string> {
  const res = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `RD ${randomUUID().slice(0, 8)}` } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  createdWorkItemIds.push(res.body.id);
  return res.body.id;
}
async function addLine(workId: string, body: Record<string, unknown>) {
  return api(BASE, `/work/${workId}/lines`, { method: "POST", token: mominToken, body });
}
async function attachLine(workLineId: string) {
  const res = await api(BASE, "/invoices/attach-line", { method: "POST", token: mominToken, body: { workLineId } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { id: string; invoiceId: string };
}

before(async () => {
  await admin.connect();
  await startServer();
  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  mominToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  clientPartyId = await makeParty("RD Client", "client");
  writerPartyId = await makeParty("RD Writer", "writer");
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$1)", [id]);
    await admin.query("delete from invoice_line where work_line_id in (select id from work_line where work_item_id=$1)", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  await admin.query("delete from invoice where client_party_id=$1", [clientPartyId]);
  for (const id of createdPartyIds) await admin.query("delete from party where id=$1", [id]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("discount line kind (negative client amount, P1 item 6)", () => {
  it("a discount consumer line reduces the invoice due; a fully-discounted job is 'settled'", async () => {
    const workId = await createWorkItem();
    const bill = await addLine(workId, { lineKind: "part", consumerPartyId: clientPartyId, fixedAmount: 5000 });
    assert.equal(bill.status, 201, JSON.stringify(bill.body));
    const disc = await addLine(workId, { lineKind: "discount", consumerPartyId: clientPartyId, fixedAmount: -1000, note: "volume discount" });
    assert.equal(disc.status, 201, JSON.stringify(disc.body));

    const a1 = await attachLine(bill.body.id);
    await attachLine(disc.body.id);
    const inv = await api(BASE, `/invoices/${a1.invoiceId}`, { token: mominToken });
    const dueSum = (inv.body.lines as Array<any>).reduce((s, l) => s + Number(l.due), 0);
    assert.equal(dueSum, 4000, "৳5000 − ৳1000 discount = ৳4000 net due");

    // A SECOND discount that credits the rest → net 0 → settled (not unbilled).
    const disc2 = await addLine(workId, { lineKind: "discount", consumerPartyId: clientPartyId, fixedAmount: -4000 });
    await attachLine(disc2.body.id);
    const detail = await api(BASE, `/work/${workId}`, { token: mominToken });
    assert.equal(detail.body.item.moneyState, "settled", "a fully-credited job owes nothing → settled");
  });

  it("a negative amount on a NON-discount line is rejected (400)", async () => {
    const workId = await createWorkItem();
    const res = await addLine(workId, { lineKind: "part", consumerPartyId: clientPartyId, fixedAmount: -500 });
    assert.equal(res.status, 400, "only a 'discount' line may be negative");
  });

  it("a discount line without a consumer (client-side) is rejected (400)", async () => {
    const workId = await createWorkItem();
    const res = await addLine(workId, { lineKind: "discount", writerPartyId, fixedAmount: -500 });
    assert.equal(res.status, 400, "a discount is client-side");
  });
});

describe("re-price a posted leg pair (append-only delta leg, P1 item 6)", () => {
  it("reprices Momin→Writer 3000 → 4000 via a delta leg; margins recompute", async () => {
    const workId = await createWorkItem();
    const legs = await api(BASE, `/work/${workId}/legs`, {
      method: "POST",
      token: mominToken,
      body: {
        legs: [
          { seq: 1, fromPartyId: clientPartyId, toPartyId: MOMIN_PARTY, amount: 6000 },
          { seq: 3, fromPartyId: MOMIN_PARTY, toPartyId: writerPartyId, amount: 3000 },
        ],
      },
    });
    assert.equal(legs.status, 201, JSON.stringify(legs.body));

    // Before: Momin margin = 6000 − 3000 = 3000.
    const before = await api(BASE, `/work/${workId}/legs`, { token: sysToken });
    const mBefore = (before.body.margins as Array<any>).find((m) => m.partyId === MOMIN_PARTY);
    assert.equal(mBefore.margin, 3000);

    const rp = await api(BASE, `/work/${workId}/legs/reprice`, {
      method: "POST",
      token: mominToken,
      body: { fromPartyId: MOMIN_PARTY, toPartyId: writerPartyId, newAmount: 4000, note: "renegotiated writer fee" },
    });
    assert.equal(rp.status, 200, JSON.stringify(rp.body));
    assert.equal(rp.body.current, 3000);
    assert.equal(rp.body.delta, 1000, "delta = 4000 − 3000");

    // After: the writer now nets ৳4000, so Momin margin = 6000 − 4000 = 2000.
    const after = await api(BASE, `/work/${workId}/legs`, { token: sysToken });
    const mAfter = (after.body.margins as Array<any>).find((m) => m.partyId === MOMIN_PARTY);
    assert.equal(mAfter.margin, 2000, "the delta leg nets the pair to the new total");
  });

  it("reprice can stamp a writer line's note so the writer sees the fee was adjusted", async () => {
    const workId = await createWorkItem();
    const producer = await addLine(workId, { lineKind: "part", writerPartyId, fixedAmount: 3000 });
    assert.equal(producer.status, 201, JSON.stringify(producer.body));
    await api(BASE, `/work/${workId}/legs`, {
      method: "POST",
      token: mominToken,
      body: { legs: [{ seq: 3, fromPartyId: MOMIN_PARTY, toPartyId: writerPartyId, amount: 3000 }] },
    });
    const rp = await api(BASE, `/work/${workId}/legs/reprice`, {
      method: "POST",
      token: mominToken,
      body: { fromPartyId: MOMIN_PARTY, toPartyId: writerPartyId, newAmount: 2500, note: "fee reduced for a client discount", stampLineId: producer.body.id },
    });
    assert.equal(rp.status, 200, JSON.stringify(rp.body));
    const detail = await api(BASE, `/work/${workId}`, { token: sysToken });
    const line = (detail.body.lines as Array<any>).find((l) => l.id === producer.body.id);
    assert.equal(line.note, "fee reduced for a client discount", "the writer's line carries the fee-adjusted note");
  });
});
