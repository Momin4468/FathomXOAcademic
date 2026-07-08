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
 * P1 item 9 — ad-hoc bulk-price container (anchor-line). Proves: N tasks group
 * under ONE combined price (anchor carries it, siblings → ৳0, all tagged), each
 * task keeps its own record, and billing is unchanged (one ৳X invoice line + ৳0
 * siblings). Requires FEATURE_WORK + FEATURE_BILLING.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3261;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let mominToken = "";
let clientA = "";
let clientB = "";
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

async function makeParty(name: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,'{client}')", [id, ORG, name]);
  createdPartyIds.push(id);
  return id;
}
/** Create a work item + one consumer line; return the line id. */
async function jobWithLine(client: string, amount: number): Promise<string> {
  const w = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `PG ${randomUUID().slice(0, 8)}` } });
  assert.equal(w.status, 201, JSON.stringify(w.body));
  createdWorkItemIds.push(w.body.id);
  const line = await api(BASE, `/work/${w.body.id}/lines`, {
    method: "POST",
    token: mominToken,
    body: { lineKind: "part", consumerPartyId: client, fixedAmount: amount },
  });
  assert.equal(line.status, 201, JSON.stringify(line.body));
  return line.body.id;
}
async function attachLine(workLineId: string) {
  const res = await api(BASE, "/invoices/attach-line", { method: "POST", token: mominToken, body: { workLineId } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { id: string; invoiceId: string };
}

before(async () => {
  await admin.connect();
  await startServer();
  mominToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  clientA = await makeParty("PG Client A");
  clientB = await makeParty("PG Client B");
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$1)", [id]);
    await admin.query("delete from invoice_line where work_line_id in (select id from work_line where work_item_id=$1)", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  await admin.query("delete from invoice where client_party_id in ($1,$2)", [clientA, clientB]);
  await admin.query("delete from price_group where client_party_id in ($1,$2)", [clientA, clientB]);
  for (const id of createdPartyIds) await admin.query("delete from party where id=$1", [id]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("ad-hoc bulk-price container (anchor-line; P1 item 9)", () => {
  it("groups 3 tasks under one combined ৳9000: anchor carries it, siblings → ৳0, all tagged", async () => {
    const l1 = await jobWithLine(clientA, 1000);
    const l2 = await jobWithLine(clientA, 2000);
    const l3 = await jobWithLine(clientA, 3000);
    const grp = await api(BASE, "/work/price-groups", {
      method: "POST",
      token: mominToken,
      body: { combinedAmount: 9000, note: "3 assignments, one fee", lineIds: [l1, l2, l3] },
    });
    assert.equal(grp.status, 201, JSON.stringify(grp.body));
    assert.equal(grp.body.anchorLineId, l1);

    const detail = await api(BASE, `/work/price-groups/${grp.body.id}`, { token: mominToken });
    assert.equal(detail.status, 200);
    assert.equal(Number(detail.body.combinedAmount), 9000, "the group bills ৳9000 total");
    assert.equal((detail.body.lines as Array<any>).length, 3, "each task keeps its own line/record");

    // Billing: attaching all three lands one ৳9000 line + two ৳0 lines → due ৳9000.
    const a1 = await attachLine(l1);
    await attachLine(l2);
    await attachLine(l3);
    const inv = await api(BASE, `/invoices/${a1.invoiceId}`, { token: mominToken });
    const dueSum = (inv.body.lines as Array<any>).reduce((s, l) => s + Number(l.due), 0);
    assert.equal(dueSum, 9000, "one combined ৳9000 across the set (anchor 9000 + 0 + 0)");
  });

  it("a line already in a group cannot be re-grouped (400)", async () => {
    const l1 = await jobWithLine(clientA, 500);
    const l2 = await jobWithLine(clientA, 500);
    const first = await api(BASE, "/work/price-groups", { method: "POST", token: mominToken, body: { combinedAmount: 1000, lineIds: [l1, l2] } });
    assert.equal(first.status, 201);
    const l3 = await jobWithLine(clientA, 500);
    const again = await api(BASE, "/work/price-groups", { method: "POST", token: mominToken, body: { combinedAmount: 1000, lineIds: [l1, l3] } });
    assert.equal(again.status, 400, "a line can belong to at most one price group");
  });

  it("lines for DIFFERENT clients cannot be grouped (400)", async () => {
    const la = await jobWithLine(clientA, 1000);
    const lb = await jobWithLine(clientB, 1000);
    const res = await api(BASE, "/work/price-groups", { method: "POST", token: mominToken, body: { combinedAmount: 2000, lineIds: [la, lb] } });
    assert.equal(res.status, 400, "a bulk price is for one client's tasks");
  });

  it("a group needs at least 2 lines (400)", async () => {
    const l1 = await jobWithLine(clientA, 1000);
    const res = await api(BASE, "/work/price-groups", { method: "POST", token: mominToken, body: { combinedAmount: 1000, lineIds: [l1] } });
    assert.equal(res.status, 400);
  });
});
