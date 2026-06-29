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
 * AI capture assistant (migration 0030, DESIGN_SPEC §10 capture-first / §2
 * governance) — BLACK-BOX HTTP tests against the COMPILED app (dist/main.js).
 *
 * The invariants under test (the ones that must never silently break):
 *   • EXTRACT proposes ONLY — it commits NO domain row (no party/work_item/
 *     payment/expense). Only ai_proposal rows (status pending) appear.
 *   • A domain row is created ONLY on explicit human ACCEPT, and every such row
 *     carries the `ai_capture_id` provenance marker (money created only on accept).
 *   • Accept routes through the REAL create DTO + the SAME create permission a
 *     manual create needs — no escalation (a non-billing user cannot mint a
 *     payment via Accept).
 *   • Reject/double-accept/invalid-edit create nothing / 400.
 *   • The per-user daily cap returns 429.
 *
 * Spawns TWO instances: a normal one (high cap) and a second with
 * AI_CAPTURE_DAILY_CAP=2 for the cap test. Requires the AI capture feature flag +
 * the dependent module flags + the deterministic `dev` provider.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3240; // dedicated test port (normal cap)
const CAP_PORT = 3241; // second instance, AI_CAPTURE_DAILY_CAP=2
const BASE = `http://localhost:${PORT}`;
const CAP_BASE = `http://localhost:${CAP_PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work+capture only — NO ai_capture, NO billing

// The deterministic dev-provider input: one line per expected target type.
const FOUR_LINES = [
  "Received 12000 BDT from client", // → payment in 12000
  "Paid 5000 to writer for ICT701 essay", // → payment out 5000
  "Spent 800 on subscription", // → expense subscription 800
  "New client: John Smith", // → client "John Smith"
].join("\n");

let server: ChildProcess;
let capServer: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin (a3) — has ai_capture:create + reference/work/billing/expenses create
let writerToken = ""; // a6 Writer — NO ai_capture:create (controller-level block)
let captureWriterToken = ""; // custom role: ai_capture:create + expenses:create, but NO billing:create

const createdUserIds: string[] = [];
const createdCaptureIds: string[] = [];
let customRoleId = "";

function spawnServer(port: number, extraEnv: Record<string, string>): ChildProcess {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  const proc = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      FEATURE_AI_CAPTURE: "true",
      FEATURE_WORK: "true",
      FEATURE_BILLING: "true",
      FEATURE_EXPENSES: "true",
      FEATURE_REFERENCE: "true",
      AI_CAPTURE_PROVIDER: "dev",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api:${port}] ${s}`);
  });
  return proc;
}

async function login(base: string, email: string, password: string) {
  return api(base, "/auth/login", { method: "POST", body: { email, password } });
}

/** Create a login (via sysadmin), assign one role, log it in. Returns token+id. */
async function makeUserWithRole(roleId: string): Promise<{ token: string; userId: string; email: string }> {
  const email = `aicap+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD } });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(BASE, email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId, email };
}

/** POST /ai-capture and return the capture response { capture, proposals, note }. */
async function extractText(base: string, token: string, text: string) {
  const res = await api(base, "/ai-capture", { method: "POST", token, body: { kind: "text", text } });
  if (res.status === 201 && res.body?.capture?.id) createdCaptureIds.push(res.body.capture.id);
  return res;
}

const proposalOf = (body: any, target: string) =>
  (body.proposals as Array<any>).find((p) => p.targetType === target);

async function countByCapture(table: string, captureId: string): Promise<number> {
  const r = await admin.query(`select count(*)::int c from ${table} where ai_capture_id = $1`, [captureId]);
  return Number(r.rows[0].c);
}

before(async () => {
  await admin.connect();
  // The compiled app takes ~25-30s to reach app.listen on this host; give both
  // instances a generous health window (they boot in parallel).
  server = spawnServer(PORT, {});
  capServer = spawnServer(CAP_PORT, { AI_CAPTURE_DAILY_CAP: "2" });
  await waitForHealth(BASE, 120000);
  await waitForHealth(CAP_BASE, 120000);

  const s = await login(BASE, "sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200);
  sysToken = s.body.accessToken;

  const m = await login(BASE, "momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;

  // A plain Writer (a6) — has no ai_capture permission at all.
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE));

  // A custom role that CAN capture + accept expenses but CANNOT accept payments
  // (no billing:create) — proves Accept can't escalate past the target's create perm.
  customRoleId = randomUUID();
  await admin.query("insert into role (id, org_id, name, is_system) values ($1,$2,$3,false)", [
    customRoleId,
    ORG,
    `AI Capture (no billing) ${customRoleId.slice(0, 8)}`,
  ]);
  for (const [mod, act] of [
    ["ai_capture", "view"],
    ["ai_capture", "create"],
    ["expenses", "view"],
    ["expenses", "create"],
  ]) {
    await admin.query("insert into permission (org_id, role_id, module, action) values ($1,$2,$3,$4)", [ORG, customRoleId, mod, act]);
  }
  ({ token: captureWriterToken } = await makeUserWithRole(customRoleId));
});

after(async () => {
  // Domain rows created by accepted proposals — delete by the provenance marker.
  for (const id of createdCaptureIds) {
    await admin.query("delete from payment_allocation where payment_id in (select id from payment where ai_capture_id=$1)", [id]);
    await admin.query("delete from payment where ai_capture_id=$1", [id]);
    await admin.query("delete from expense where ai_capture_id=$1", [id]);
    await admin.query("delete from work_item where ai_capture_id=$1", [id]);
    await admin.query("delete from party where ai_capture_id=$1", [id]);
    await admin.query("delete from ai_proposal where capture_id=$1", [id]);
    await admin.query("delete from ai_usage where capture_id=$1", [id]);
    await admin.query("delete from audit_log where entity='ai_capture' and entity_id=$1", [id]);
    await admin.query("delete from ai_capture where id=$1", [id]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from ai_usage where user_id=$1", [id]);
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  if (customRoleId) {
    await admin.query("delete from permission where role_id=$1", [customRoleId]);
    await admin.query("delete from role where id=$1", [customRoleId]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
  if (capServer && !capServer.killed) capServer.kill();
});

// ─── 1. Extract proposes, commits nothing ────────────────────────────────────

describe("extract — proposes drafts, commits NO domain row", () => {
  it("POST /ai-capture returns 201 with proposals of the expected target types", async () => {
    const res = await extractText(BASE, mominToken, FOUR_LINES);
    assert.equal(res.status, 201, `extract should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.ok(res.body.capture?.id, "a capture row is returned");
    assert.equal(res.body.capture.status, "proposed", "capture status moves to proposed");

    const targets = (res.body.proposals as Array<any>).map((p) => p.targetType).sort();
    assert.deepEqual(targets, ["client", "expense", "payment", "payment"], `proposed target types (got ${JSON.stringify(targets)})`);
    for (const p of res.body.proposals as Array<any>) {
      assert.equal(p.status, "pending", "every proposal starts pending (a draft, not a fact)");
      assert.equal(p.createdEntityId, null, "no entity is created at extract time");
    }
    // The two payments split in vs out by direction.
    const pays = (res.body.proposals as Array<any>).filter((p) => p.targetType === "payment");
    const dirs = pays.map((p) => p.proposedJson.direction).sort();
    assert.deepEqual(dirs, ["in", "out"], "the two payment proposals are one in (received) + one out (paid)");
  });

  it("NO domain row exists for this capture yet — only pending ai_proposal rows", async () => {
    const res = await extractText(BASE, mominToken, FOUR_LINES);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const captureId = res.body.capture.id as string;

    assert.equal(await countByCapture("payment", captureId), 0, "no payment committed at extract");
    assert.equal(await countByCapture("expense", captureId), 0, "no expense committed at extract");
    assert.equal(await countByCapture("work_item", captureId), 0, "no work_item committed at extract");
    assert.equal(await countByCapture("party", captureId), 0, "no party committed at extract");

    const props = await admin.query("select count(*)::int c, count(*) filter (where status='pending')::int p from ai_proposal where capture_id=$1", [captureId]);
    assert.equal(Number(props.rows[0].c), 4, "four proposal rows persisted");
    assert.equal(Number(props.rows[0].p), 4, "all four are pending");
  });
});

// ─── 2. Accept creates with provenance ───────────────────────────────────────

describe("accept — creates the real record, AI-stamped (money only on accept)", () => {
  it("accept an EXPENSE proposal → expense row with ai_capture_id set", async () => {
    const cap = await extractText(BASE, mominToken, "Spent 800 on subscription");
    const captureId = cap.body.capture.id as string;
    const prop = proposalOf(cap.body, "expense");
    assert.ok(prop, "an expense proposal exists");

    const acc = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(acc.status, 201, `accept should succeed (got ${acc.status}: ${JSON.stringify(acc.body)})`);
    assert.equal(acc.body.createdEntityType, "expense");

    const row = await admin.query("select amount, ai_capture_id from expense where id=$1", [acc.body.createdEntityId]);
    assert.equal(row.rowCount, 1, "the expense row was created");
    assert.equal(row.rows[0].ai_capture_id, captureId, "the expense carries the ai_capture_id provenance marker");
    assert.equal(Number(row.rows[0].amount), 800, "the accepted expense amount matches the proposal");
  });

  it("accept a PAYMENT proposal → payment row with ai_capture_id set (money created only on accept)", async () => {
    const cap = await extractText(BASE, mominToken, "Received 12000 BDT from client");
    const captureId = cap.body.capture.id as string;
    const prop = proposalOf(cap.body, "payment");
    assert.ok(prop, "a payment proposal exists");

    const acc = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(acc.status, 201, `accept should succeed (got ${acc.status}: ${JSON.stringify(acc.body)})`);
    assert.equal(acc.body.createdEntityType, "payment");

    const row = await admin.query("select amount, direction, ai_capture_id from payment where id=$1", [acc.body.createdEntityId]);
    assert.equal(row.rowCount, 1, "the payment row was created");
    assert.equal(row.rows[0].ai_capture_id, captureId, "the payment carries the ai_capture_id provenance marker");
    assert.equal(Number(row.rows[0].amount), 12000, "the accepted payment amount matches");
    assert.equal(row.rows[0].direction, "in", "direction preserved from the proposal");
  });

  it("accept a CLIENT proposal → party row with ai_capture_id set", async () => {
    const cap = await extractText(BASE, mominToken, "New client: John Smith");
    const captureId = cap.body.capture.id as string;
    const prop = proposalOf(cap.body, "client");
    assert.ok(prop, "a client proposal exists");

    const acc = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(acc.status, 201, `accept should succeed (got ${acc.status}: ${JSON.stringify(acc.body)})`);
    assert.equal(acc.body.createdEntityType, "party");

    const row = await admin.query("select display_name, ai_capture_id from party where id=$1", [acc.body.createdEntityId]);
    assert.equal(row.rowCount, 1, "the party row was created");
    assert.equal(row.rows[0].ai_capture_id, captureId, "the party carries the ai_capture_id provenance marker");
    assert.equal(row.rows[0].display_name, "John Smith", "the accepted client name matches");
  });

  it("accept a JOB proposal → work_item created in DRAFT state, AI-stamped", async () => {
    const cap = await extractText(BASE, mominToken, "ICT701 essay assignment due next week");
    const captureId = cap.body.capture.id as string;
    const prop = proposalOf(cap.body, "job");
    assert.ok(prop, `a job proposal exists (got ${JSON.stringify((cap.body.proposals as any[]).map((p) => p.targetType))})`);

    const acc = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(acc.status, 201, `accept should succeed (got ${acc.status}: ${JSON.stringify(acc.body)})`);
    assert.equal(acc.body.createdEntityType, "work_item");

    const row = await admin.query("select work_state, ai_capture_id from work_item where id=$1", [acc.body.createdEntityId]);
    assert.equal(row.rowCount, 1, "the work_item row was created");
    assert.equal(row.rows[0].ai_capture_id, captureId, "the work_item carries the ai_capture_id provenance marker");
    assert.equal(row.rows[0].work_state, "draft", "an AI-accepted job lands in draft (not auto-confirmed)");
  });
});

// ─── 3. Edit then accept ─────────────────────────────────────────────────────

describe("edit then accept — the created record reflects the edit", () => {
  it("editing an expense amount then accepting persists the EDITED amount", async () => {
    const cap = await extractText(BASE, mominToken, "Spent 800 on subscription");
    const prop = proposalOf(cap.body, "expense");

    const ed = await api(BASE, `/ai-capture/proposals/${prop.id}/edit`, { method: "POST", token: mominToken, body: { fields: { amount: 999 } } });
    assert.equal(ed.status, 201, `edit should succeed (got ${ed.status}: ${JSON.stringify(ed.body)})`);
    assert.equal(Number(ed.body.proposedJson.amount), 999, "the proposal's draft amount is updated");
    assert.equal(ed.body.proposedJson.category, "subscription", "edit merges (other fields preserved)");

    const acc = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(acc.status, 201, JSON.stringify(acc.body));
    const row = await admin.query("select amount from expense where id=$1", [acc.body.createdEntityId]);
    assert.equal(Number(row.rows[0].amount), 999, "the created expense reflects the edited amount, not the original 800");
  });
});

// ─── 4. Reject creates nothing ───────────────────────────────────────────────

describe("reject — marks rejected, creates no domain row", () => {
  it("rejecting a payment proposal sets status rejected and creates no payment", async () => {
    const cap = await extractText(BASE, mominToken, "Received 12000 BDT from client");
    const captureId = cap.body.capture.id as string;
    const prop = proposalOf(cap.body, "payment");

    const rej = await api(BASE, `/ai-capture/proposals/${prop.id}/reject`, { method: "POST", token: mominToken });
    assert.equal(rej.status, 201, `reject should succeed (got ${rej.status}: ${JSON.stringify(rej.body)})`);

    const st = await admin.query("select status, created_entity_id from ai_proposal where id=$1", [prop.id]);
    assert.equal(st.rows[0].status, "rejected", "the proposal is marked rejected");
    assert.equal(st.rows[0].created_entity_id, null, "no entity recorded on a rejected proposal");
    assert.equal(await countByCapture("payment", captureId), 0, "rejecting created no payment");
  });
});

// ─── 5. No re-accept / no double-create ───────────────────────────────────────

describe("idempotency — a settled proposal cannot be re-actioned", () => {
  it("accepting an already-accepted proposal → 400 (no double-create)", async () => {
    const cap = await extractText(BASE, mominToken, "Spent 800 on subscription");
    const captureId = cap.body.capture.id as string;
    const prop = proposalOf(cap.body, "expense");

    const first = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(second.status, 400, `a re-accept must be rejected (got ${second.status}: ${JSON.stringify(second.body)})`);

    assert.equal(await countByCapture("expense", captureId), 1, "only ONE expense exists despite two accept calls");
  });

  it("rejecting an already-rejected proposal → 400", async () => {
    const cap = await extractText(BASE, mominToken, "Received 12000 BDT from client");
    const prop = proposalOf(cap.body, "payment");
    const first = await api(BASE, `/ai-capture/proposals/${prop.id}/reject`, { method: "POST", token: mominToken });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await api(BASE, `/ai-capture/proposals/${prop.id}/reject`, { method: "POST", token: mominToken });
    assert.equal(second.status, 400, "a rejected proposal cannot be re-rejected");
  });

  it("accepting a rejected proposal → 400", async () => {
    const cap = await extractText(BASE, mominToken, "Spent 800 on subscription");
    const captureId = cap.body.capture.id as string;
    const prop = proposalOf(cap.body, "expense");
    const rej = await api(BASE, `/ai-capture/proposals/${prop.id}/reject`, { method: "POST", token: mominToken });
    assert.equal(rej.status, 201);
    const acc = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(acc.status, 400, "a rejected proposal cannot then be accepted");
    assert.equal(await countByCapture("expense", captureId), 0, "no expense created from a rejected proposal");
  });
});

// ─── 6. Permission gate — no escalation ───────────────────────────────────────

describe("authz — capture + accept cannot escalate", () => {
  it("a Writer with NO ai_capture permission → POST /ai-capture is 403", async () => {
    const res = await api(BASE, "/ai-capture", { method: "POST", token: writerToken, body: { kind: "text", text: FOUR_LINES } });
    assert.equal(res.status, 403, `the capture endpoint requires ai_capture:create (got ${res.status}: ${JSON.stringify(res.body)})`);
  });

  it("a capturer WITHOUT billing:create cannot Accept a PAYMENT proposal → 403", async () => {
    // This user can capture and accept expenses, but has no billing:create.
    const cap = await extractText(BASE, captureWriterToken, "Received 12000 BDT from client");
    assert.equal(cap.status, 201, `the capturer can extract (got ${cap.status}: ${JSON.stringify(cap.body)})`);
    const captureId = cap.body.capture.id as string;
    const pay = proposalOf(cap.body, "payment");
    assert.ok(pay, "a payment proposal exists");

    const acc = await api(BASE, `/ai-capture/proposals/${pay.id}/accept`, { method: "POST", token: captureWriterToken });
    assert.equal(acc.status, 403, `accepting a payment must require billing:create (got ${acc.status}: ${JSON.stringify(acc.body)})`);
    assert.match(JSON.stringify(acc.body), /billing:create/, "the error names the missing permission");
    assert.equal(await countByCapture("payment", captureId), 0, "no payment was minted by the under-permissioned user");
  });

  it("the SAME under-permissioned capturer CAN Accept an EXPENSE proposal (has expenses:create)", async () => {
    const cap = await extractText(BASE, captureWriterToken, "Spent 800 on subscription");
    const captureId = cap.body.capture.id as string;
    const exp = proposalOf(cap.body, "expense");
    const acc = await api(BASE, `/ai-capture/proposals/${exp.id}/accept`, { method: "POST", token: captureWriterToken });
    assert.equal(acc.status, 201, `expense accept should succeed for an expenses:create holder (got ${acc.status}: ${JSON.stringify(acc.body)})`);
    assert.equal(await countByCapture("expense", captureId), 1, "the permitted expense WAS created (gate is per-target, not blanket)");
  });
});

// ─── 7. Daily cap ─────────────────────────────────────────────────────────────

describe("daily cap — the per-user limit returns 429", () => {
  it("with AI_CAPTURE_DAILY_CAP=2, the 3rd capture by the same user → 429", async () => {
    // A FRESH user so today's usage starts at 0 (the cap counts current_date rows).
    const { token, userId } = await makeUserWithRole(customRoleId);
    // Track captures for cleanup via the by-user ai_usage delete in `after`.
    const cap1 = await api(CAP_BASE, "/ai-capture", { method: "POST", token, body: { kind: "text", text: "Spent 800 on subscription" } });
    assert.equal(cap1.status, 201, `1st capture under cap (got ${cap1.status}: ${JSON.stringify(cap1.body)})`);
    if (cap1.body?.capture?.id) createdCaptureIds.push(cap1.body.capture.id);

    const cap2 = await api(CAP_BASE, "/ai-capture", { method: "POST", token, body: { kind: "text", text: "Spent 800 on subscription" } });
    assert.equal(cap2.status, 201, `2nd capture under cap (got ${cap2.status}: ${JSON.stringify(cap2.body)})`);
    if (cap2.body?.capture?.id) createdCaptureIds.push(cap2.body.capture.id);

    const cap3 = await api(CAP_BASE, "/ai-capture", { method: "POST", token, body: { kind: "text", text: "Spent 800 on subscription" } });
    assert.equal(cap3.status, 429, `the 3rd capture must hit the daily cap (got ${cap3.status}: ${JSON.stringify(cap3.body)})`);

    // The cap blocks BEFORE inserting a capture row → exactly 2 usage rows today.
    const u = await admin.query("select count(*)::int c from ai_usage where user_id=$1 and used_on=current_date", [userId]);
    assert.equal(Number(u.rows[0].c), 2, "the capped 3rd call left no usage row (blocked before extraction)");
  });
});

// ─── 8. Validation reuse — an invalid edit fails at accept ─────────────────────

describe("validation — accept reuses the real create DTO", () => {
  it("editing an expense amount to negative then accepting → 400 (DTO @Min(0))", async () => {
    const cap = await extractText(BASE, mominToken, "Spent 800 on subscription");
    const captureId = cap.body.capture.id as string;
    const prop = proposalOf(cap.body, "expense");

    const ed = await api(BASE, `/ai-capture/proposals/${prop.id}/edit`, { method: "POST", token: mominToken, body: { fields: { amount: -50 } } });
    assert.equal(ed.status, 201, "the edit itself is stored (validation is at accept time)");

    const acc = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(acc.status, 400, `an invalid amount must be rejected at accept (got ${acc.status}: ${JSON.stringify(acc.body)})`);
    assert.equal(await countByCapture("expense", captureId), 0, "no expense created from an invalid proposal");

    // The proposal stays pending (accept failed) — it was not consumed.
    const st = await admin.query("select status from ai_proposal where id=$1", [prop.id]);
    assert.equal(st.rows[0].status, "pending", "a failed accept leaves the proposal pending (correctable)");
  });

  it("editing an expense to an invalid category then accepting → 400", async () => {
    const cap = await extractText(BASE, mominToken, "Spent 800 on subscription");
    const captureId = cap.body.capture.id as string;
    const prop = proposalOf(cap.body, "expense");
    await api(BASE, `/ai-capture/proposals/${prop.id}/edit`, { method: "POST", token: mominToken, body: { fields: { category: "not_a_category" } } });
    const acc = await api(BASE, `/ai-capture/proposals/${prop.id}/accept`, { method: "POST", token: mominToken });
    assert.equal(acc.status, 400, "an out-of-enum category is rejected by the reused DTO");
    assert.equal(await countByCapture("expense", captureId), 0, "no expense created");
  });
});

// ─── 9. Tenant scoping / visibility of a capture ──────────────────────────────

describe("scoping — a capture is org-scoped and readable by its org", () => {
  it("GET /ai-capture/:id returns the capture + its proposals for the owner org", async () => {
    const cap = await extractText(BASE, mominToken, FOUR_LINES);
    const captureId = cap.body.capture.id as string;
    const got = await api(BASE, `/ai-capture/${captureId}`, { token: mominToken });
    assert.equal(got.status, 200, `the owner org can read its capture (got ${got.status}: ${JSON.stringify(got.body)})`);
    assert.equal(got.body.capture.id, captureId, "the right capture is returned");
    assert.equal(got.body.capture.orgId, ORG, "the capture carries the org marker");
    assert.equal((got.body.proposals as Array<any>).length, 4, "its proposals come back with it");
    for (const p of got.body.proposals as Array<any>) {
      assert.equal(p.orgId, ORG, "every proposal is org-scoped to the owner");
    }
  });
});
