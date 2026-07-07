import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import {
  creditBalance,
  deriveCheckPnl,
  weightedCostPerCredit,
} from "@business-os/shared";
import { api, waitForHealth } from "./helpers.js";

/**
 * Module 10 (checks) — BLACK-BOX HTTP against the COMPILED app (dist/main.js).
 * Proves the request-time guarantees of the AI/plagiarism check service (§8):
 *   • a worker (checks:create) records a 'proposed' batch only on their OWN channel
 *   • 🔴 no self-confirm: the recorder cannot confirm; a non-approver cannot confirm;
 *     a different approver can
 *   • 🔴 own-only: a second worker does not see worker A's batches and cannot record
 *     on worker A's channel
 *   • only CONFIRMED batches feed the P&L (revenue/files/cost/comp) + credit burn
 *   • worker comp via comp_rule as-of period_date
 *   • 🔴 cost leak: the credit balance/cost is admin-only — a worker never sees it
 *   • stand-alone (no customer) and linked (customer party) batches both work
 *   • per-file detail add + list
 *   • authz: a Writer cannot create tool accounts or read the P&L
 *   • pure unit math from @business-os/shared
 * Requires FEATURE_CHECKS=true so the /checks routes mount.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3223; // dedicated test port for the checks module
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // checks:view+create
const EMON_PARTY = "00000000-0000-4000-8000-0000000000c2"; // emon: Admin (checks:approve)

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin (checks:approve) — also a Writer, party c1
let emonToken = ""; // a DIFFERENT Admin (checks:approve) — the confirmer
let workerAToken = "";
let workerBToken = "";
let workerAParty = "";
let workerBParty = "";

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdCompRuleIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_CHECKS: "true",
      FEATURE_WORK: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE);
}

async function login(email: string, password: string) {
  return api(BASE, "/auth/login", { method: "POST", body: { email, password } });
}

/** Create a login (sysadmin), link it to a party, assign one role, log it in. */
async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `chkuser+${randomUUID()}@fathomxo.test`;
  const body: Record<string, unknown> = { email, password: DEV_PASSWORD };
  if (partyId) body.partyId = partyId;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, {
    method: "POST",
    token: sysToken,
    body: { roleId },
  });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId };
}

/** Insert a party directly (admin) so we control its id. */
async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)",
    [id, ORG, name, `{${type}}`],
  );
  createdPartyIds.push(id);
  return id;
}

/** Insert a per-file comp rule for a party, effective in the past (admin). */
async function makeCompRule(partyId: string, basis: string, rate: number, effectiveFrom: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into comp_rule (id, org_id, party_id, basis, rate, cost_bearer, effective_from) values ($1,$2,$3,$4,$5,'writer',$6)",
    [id, ORG, partyId, basis, String(rate), effectiveFrom],
  );
  createdCompRuleIds.push(id);
  return id;
}

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  const e = await login("emon@fathomxo.local", DEV_PASSWORD);
  assert.equal(e.status, 200, "emon should log in");
  emonToken = e.body.accessToken;

  workerAParty = await makeParty("CHK Worker A", "writer");
  workerBParty = await makeParty("CHK Worker B", "writer");
  ({ token: workerAToken } = await makeUserWithRole(WRITER_ROLE, workerAParty));
  ({ token: workerBToken } = await makeUserWithRole(WRITER_ROLE, workerBParty));
});

after(async () => {
  // dependency order: check_file, check_batch, check_credit_topup, check_tool_account, check_channel
  await admin.query("delete from check_file where org_id=$1", [ORG]);
  await admin.query(
    "delete from check_batch where channel_id in (select id from check_channel where employee_party_id = any($1::uuid[]))",
    [[workerAParty, workerBParty]],
  );
  await admin.query("delete from check_credit_topup where org_id=$1 and created_by = any($2::uuid[])", [ORG, createdUserIds.length ? createdUserIds : ["00000000-0000-4000-8000-000000000000"]]);
  // top-ups + tool accounts created in tests are admin-owned by momin/emon — clean by label prefix.
  await admin.query("delete from check_credit_topup where tool_account_id in (select id from check_tool_account where label like 'CHKTEST%')");
  await admin.query("delete from check_batch where channel_id in (select id from check_channel where label like 'CHKTEST%')");
  await admin.query("delete from check_tool_account where label like 'CHKTEST%'");
  await admin.query("delete from check_channel where label like 'CHKTEST%'");
  for (const id of createdCompRuleIds) {
    await admin.query("delete from comp_rule where id=$1", [id]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    await admin.query("delete from party where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// Shared ids threaded between suites (set in the setup suite below).
const shared: { channelId: string; toolAccountId: string } = { channelId: "", toolAccountId: "" };

// ─── 1. Admin sets up channel + tool account + two top-ups ───────────────────────

describe("setup — channel, tool account, weighted top-ups (admin)", () => {
  let channelId = "";
  let toolAccountId = "";

  it("momin registers a channel for worker A's party → 201", async () => {
    const res = await api(BASE, "/checks/channels", {
      method: "POST",
      token: mominToken,
      body: { label: `CHKTEST Channel ${randomUUID().slice(0, 8)}`, employeePartyId: workerAParty },
    });
    assert.equal(res.status, 201, `channel create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.employeePartyId, workerAParty, "channel bound to worker A");
    channelId = res.body.id;
    shared.channelId = channelId;
  });

  it("momin creates a tool account → 201", async () => {
    const res = await api(BASE, "/checks/tool-accounts", {
      method: "POST",
      token: mominToken,
      body: { label: `CHKTEST AcademyCX ${randomUUID().slice(0, 8)}` },
    });
    assert.equal(res.status, 201, `tool account create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    toolAccountId = res.body.id;
    shared.toolAccountId = toolAccountId;
  });

  it("two top-ups: weighted cost-per-credit = 8000/1500 = 5.33", async () => {
    const t1 = await api(BASE, `/checks/tool-accounts/${toolAccountId}/topups`, {
      method: "POST",
      token: mominToken,
      body: { credits: 1000, cost: 5000, purchasedAt: "2026-01-01" },
    });
    assert.equal(t1.status, 201, `topup 1 (got ${t1.status}: ${JSON.stringify(t1.body)})`);
    const t2 = await api(BASE, `/checks/tool-accounts/${toolAccountId}/topups`, {
      method: "POST",
      token: mominToken,
      body: { credits: 500, cost: 3000, purchasedAt: "2026-02-01" },
    });
    assert.equal(t2.status, 201, `topup 2 (got ${t2.status}: ${JSON.stringify(t2.body)})`);

    const list = await api(BASE, "/checks/tool-accounts", { token: mominToken });
    const acc = (list.body as Array<any>).find((a) => a.id === toolAccountId);
    assert.ok(acc, "the account is listed");
    assert.ok(acc.credit, "admin sees the credit position");
    assert.equal(acc.credit.costPerCredit, 5.33, `weighted cpc 5.33 (got ${acc.credit.costPerCredit})`);
    assert.equal(acc.credit.purchased, 1500, "1500 credits purchased");
  });
});

// ─── 2. Worker records a 'proposed' batch on their own channel ───────────────────

describe("worker records a batch on their own channel (proposed)", () => {
  it("worker A POST /checks/batches → 201 status 'proposed'", async () => {
    const res = await api(BASE, "/checks/batches", {
      method: "POST",
      token: workerAToken,
      body: {
        channelId: shared.channelId,
        toolAccountId: shared.toolAccountId,
        periodDate: "2026-03-15",
        filesChecked: 10,
        filesPaid: 8,
        amountCollected: 1200,
      },
    });
    assert.equal(res.status, 201, `record should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.status, "proposed", "a recorded tally is a claim, not a fact");
  });
});

// ─── 3. 🔴 No self-confirm; non-approver cannot confirm ──────────────────────────

describe("🔴 governance — no self-confirm, approver-only", () => {
  let mominBatchId = "";

  before(async () => {
    // momin (admin) records a batch on worker A's channel — momin is the recorder.
    const res = await api(BASE, "/checks/batches", {
      method: "POST",
      token: mominToken,
      body: {
        channelId: shared.channelId,
        toolAccountId: shared.toolAccountId,
        periodDate: "2026-03-16",
        filesChecked: 4,
        filesPaid: 4,
        amountCollected: 500,
      },
    });
    assert.equal(res.status, 201, `momin record (got ${res.status}: ${JSON.stringify(res.body)})`);
    mominBatchId = res.body.id;
  });

  it("momin (the recorder) confirming their own batch → 403", async () => {
    const res = await api(BASE, `/checks/batches/${mominBatchId}/confirm`, { method: "POST", token: mominToken });
    assert.equal(res.status, 403, `recorder must not self-confirm (got ${res.status}: ${JSON.stringify(res.body)})`);
  });

  it("worker A (no checks:approve) confirming → 403", async () => {
    const res = await api(BASE, `/checks/batches/${mominBatchId}/confirm`, { method: "POST", token: workerAToken });
    assert.equal(res.status, 403, "confirm requires checks:approve");
  });

  it("emon (a different approver) confirming momin's batch → confirmed", async () => {
    const res = await api(BASE, `/checks/batches/${mominBatchId}/confirm`, { method: "POST", token: emonToken });
    assert.ok(res.status === 200 || res.status === 201, `a different approver may confirm (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.status, "confirmed");
    assert.ok(res.body.confirmedBy, "confirmer recorded");
    assert.notEqual(res.body.confirmedBy, res.body.recordedBy, "confirmer must differ from recorder");
  });
});

// ─── 4. 🔴 Own-only: worker B cannot see/record worker A's channel ───────────────

describe("🔴 own-only — a worker sees only their own channels' batches", () => {
  it("worker B GET /checks/batches does NOT include any of worker A's batches", async () => {
    const res = await api(BASE, "/checks/batches", { token: workerBToken });
    assert.equal(res.status, 200);
    const rows = res.body as Array<any>;
    const leaked = rows.filter((b) => b.channelId === shared.channelId);
    assert.deepEqual(leaked, [], "worker B must see ZERO of worker A's channel batches");
  });

  it("worker A GET /checks/batches DOES include their own batches", async () => {
    const res = await api(BASE, "/checks/batches", { token: workerAToken });
    assert.equal(res.status, 200);
    const own = (res.body as Array<any>).filter((b) => b.channelId === shared.channelId);
    assert.ok(own.length >= 1, "worker A sees their own channel's batches");
  });

  it("worker B recording on worker A's channel → 403", async () => {
    const res = await api(BASE, "/checks/batches", {
      method: "POST",
      token: workerBToken,
      body: {
        channelId: shared.channelId,
        periodDate: "2026-03-17",
        filesChecked: 1,
        filesPaid: 1,
        amountCollected: 100,
      },
    });
    assert.equal(res.status, 403, "you may only record on your own channel");
  });
});

// ─── 5/6. Only-confirmed feeds the P&L; revenue/cost/comp derived ────────────────

describe("P&L — only confirmed batches count; numbers derived", () => {
  let channelId = "";
  let toolAccountId = "";
  let batchId = "";
  const periodFrom = "2026-04-01";
  const periodTo = "2026-04-30";
  const periodDate = "2026-04-10";

  before(async () => {
    // A dedicated, isolated window so other batches don't perturb the totals.
    const ch = await api(BASE, "/checks/channels", {
      method: "POST",
      token: mominToken,
      body: { label: `CHKTEST PnL Channel ${randomUUID().slice(0, 8)}`, employeePartyId: workerAParty },
    });
    channelId = ch.body.id;
    const acc = await api(BASE, "/checks/tool-accounts", {
      method: "POST",
      token: mominToken,
      body: { label: `CHKTEST PnL AcademyCX ${randomUUID().slice(0, 8)}` },
    });
    toolAccountId = acc.body.id;
    await api(BASE, `/checks/tool-accounts/${toolAccountId}/topups`, {
      method: "POST",
      token: mominToken,
      body: { credits: 1000, cost: 5000, purchasedAt: "2026-01-01" },
    });
    await api(BASE, `/checks/tool-accounts/${toolAccountId}/topups`, {
      method: "POST",
      token: mominToken,
      body: { credits: 500, cost: 3000, purchasedAt: "2026-02-01" },
    });
    // per-file comp for worker A, rate 5, effective in the past.
    await makeCompRule(workerAParty, "per_file", 5, "2025-01-01");

    const b = await api(BASE, "/checks/batches", {
      method: "POST",
      token: workerAToken,
      body: { channelId, toolAccountId, periodDate, filesChecked: 10, filesPaid: 8, amountCollected: 1200 },
    });
    batchId = b.body.id;
  });

  it("while 'proposed', the batch contributes 0 revenue to the P&L", async () => {
    const res = await api(BASE, `/checks/pnl?from=${periodFrom}&to=${periodTo}`, { token: mominToken });
    assert.equal(res.status, 200, `pnl (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.revenue, 0, "a proposed batch is not a fact");
    assert.equal(res.body.filesChecked, 0);
  });

  it("after confirm: revenue 1200, files 10, accountCost ~53.3, workerComp 50, net derived", async () => {
    const conf = await api(BASE, `/checks/batches/${batchId}/confirm`, { method: "POST", token: emonToken });
    assert.ok(conf.status === 200 || conf.status === 201, `confirm (got ${conf.status}: ${JSON.stringify(conf.body)})`);
    assert.equal(conf.body.status, "confirmed");

    const res = await api(BASE, `/checks/pnl?from=${periodFrom}&to=${periodTo}`, { token: mominToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.revenue, 1200, "confirmed revenue");
    assert.equal(res.body.filesChecked, 10, "confirmed files checked");
    assert.equal(res.body.filesPaid, 8, "confirmed files paid");
    assert.equal(res.body.workerComp, 50, `10 × 5 = 50 (got ${res.body.workerComp})`);
    // accountCost uses the UNROUNDED per-account ratio (Σcost/Σcredits) and rounds
    // the total once: 10 × (8000/1500) = 53.333… → 53.33 (no per-credit drift).
    assert.equal(res.body.accountCost, 53.33, `10 × (8000/1500) → 53.33 (got ${res.body.accountCost})`);
    // net must equal the derived figure, computed the same way the P&L does.
    const expectedNet = deriveCheckPnl({ revenue: 1200, filesChecked: 10, filesPaid: 8, accountCost: 53.33, workerComp: 50 }).net;
    assert.equal(res.body.net, expectedNet, `1200 − 53.33 − 50 = ${expectedNet} (got ${res.body.net})`);
    assert.equal(res.body.net, 1096.67, "net is self-consistent with the derived accountCost");
  });

  it("credit balance: remaining = 1500 − 10 confirmed = 1490, cpc 5.33", async () => {
    const list = await api(BASE, "/checks/tool-accounts", { token: mominToken });
    const acc = (list.body as Array<any>).find((a) => a.id === toolAccountId);
    assert.ok(acc?.credit, "admin sees credit");
    assert.equal(acc.credit.remaining, 1490, `1500 − 10 (got ${acc.credit.remaining})`);
    assert.equal(acc.credit.costPerCredit, 5.33);
  });
});

// ─── 7. 🔴 Cost leak — workers never see the credit/cost ─────────────────────────

describe("🔴 cost opacity — the credit balance is admin-only", () => {
  it("a worker GET /checks/tool-accounts → accounts have NO `credit` field", async () => {
    const res = await api(BASE, "/checks/tool-accounts", { token: workerAToken });
    assert.equal(res.status, 200, "a worker may pick a tool account");
    for (const a of res.body as Array<any>) {
      assert.equal(a.credit, undefined, "a worker must never see credit/cost (P&L-adjacent)");
      assert.equal(a.costPerCredit, undefined, "no cost-per-credit leak");
    }
  });
});

// ─── 8. Stand-alone vs linked batches ────────────────────────────────────────────

describe("stand-alone vs linked batches", () => {
  it("a batch with NO customerPartyId works (a check stands alone)", async () => {
    const res = await api(BASE, "/checks/batches", {
      method: "POST",
      token: workerAToken,
      body: { channelId: shared.channelId, periodDate: "2026-05-01", filesChecked: 2, filesPaid: 2, amountCollected: 200 },
    });
    assert.equal(res.status, 201, `stand-alone (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.customerPartyId, null);
  });

  it("a batch WITH a customerPartyId works (linked client)", async () => {
    const client = await makeParty("CHK Linked Client", "client");
    const res = await api(BASE, "/checks/batches", {
      method: "POST",
      token: workerAToken,
      body: { channelId: shared.channelId, periodDate: "2026-05-02", filesChecked: 2, filesPaid: 2, amountCollected: 200, customerPartyId: client },
    });
    assert.equal(res.status, 201, `linked (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.customerPartyId, client);
  });
});

// ─── 9. Per-file detail ──────────────────────────────────────────────────────────

describe("per-file detail — add + list", () => {
  let batchId = "";

  before(async () => {
    const b = await api(BASE, "/checks/batches", {
      method: "POST",
      token: workerAToken,
      body: { channelId: shared.channelId, periodDate: "2026-05-03", filesChecked: 1, filesPaid: 1, amountCollected: 150 },
    });
    batchId = b.body.id;
  });

  it("POST /checks/batches/:id/files → 201", async () => {
    const res = await api(BASE, `/checks/batches/${batchId}/files`, {
      method: "POST",
      token: workerAToken,
      body: { aiScore: 12.5, plagiarismScore: 3 },
    });
    assert.equal(res.status, 201, `add file (got ${res.status}: ${JSON.stringify(res.body)})`);
  });

  it("GET /checks/batches/:id/files lists it", async () => {
    const res = await api(BASE, `/checks/batches/${batchId}/files`, { token: workerAToken });
    assert.equal(res.status, 200);
    assert.ok((res.body as Array<any>).length >= 1, "the file is listed");
    assert.equal(Number((res.body as Array<any>)[0].aiScore), 12.5);
  });
});

// ─── 10. Authz — a Writer cannot manage accounts or read the P&L ─────────────────

describe("authz — admin-only surfaces are forbidden to a worker", () => {
  it("worker POST /checks/tool-accounts → 403", async () => {
    const res = await api(BASE, "/checks/tool-accounts", {
      method: "POST",
      token: workerAToken,
      body: { label: "CHKTEST hostile account" },
    });
    assert.equal(res.status, 403, "tool accounts need checks:approve");
  });

  it("worker GET /checks/pnl → 403", async () => {
    const res = await api(BASE, "/checks/pnl", { token: workerAToken });
    assert.equal(res.status, 403, "the P&L needs checks:approve");
  });

  it("worker POST /checks/tool-accounts/:id/topups → 403", async () => {
    const res = await api(BASE, `/checks/tool-accounts/${shared.toolAccountId}/topups`, {
      method: "POST",
      token: workerAToken,
      body: { credits: 100, cost: 500, purchasedAt: "2026-01-01" },
    });
    assert.equal(res.status, 403, "top-ups need checks:approve");
  });
});

// ─── 11. Pure unit math (no server) ──────────────────────────────────────────────

describe("pure unit math — @business-os/shared", () => {
  it("weightedCostPerCredit([1000@5000, 500@3000]) ≈ 5.33", () => {
    assert.equal(weightedCostPerCredit([{ credits: 1000, cost: 5000 }, { credits: 500, cost: 3000 }]), 5.33);
  });

  it("weightedCostPerCredit([]) = 0 (no divide-by-zero)", () => {
    assert.equal(weightedCostPerCredit([]), 0);
  });

  it("deriveCheckPnl → net 1096.67, marginPerCheck ≈ 109.67", () => {
    const pnl = deriveCheckPnl({ revenue: 1200, filesChecked: 10, filesPaid: 8, accountCost: 53.33, workerComp: 50 });
    assert.equal(pnl.net, 1096.67);
    assert.equal(pnl.marginPerCheck, 109.67);
  });

  it("deriveCheckPnl with 0 files → marginPerCheck null (no divide-by-zero)", () => {
    const pnl = deriveCheckPnl({ revenue: 0, filesChecked: 0, filesPaid: 0, accountCost: 0, workerComp: 0 });
    assert.equal(pnl.marginPerCheck, null);
  });

  it("creditBalance: 1500 purchased − 10 consumed = 1490 remaining, cpc 5.33", () => {
    const cb = creditBalance([{ credits: 1000, cost: 5000 }, { credits: 500, cost: 3000 }], 10);
    assert.equal(cb.purchased, 1500);
    assert.equal(cb.consumed, 10);
    assert.equal(cb.remaining, 1490);
    assert.equal(cb.costPerCredit, 5.33);
  });
});
