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
 * Module 6 (expenses) — BLACK-BOX HTTP tests against the COMPILED app
 * (dist/main.js). Proves:
 *   • each cost-bearer flavor (salary/subscription/promo/loss) creates cleanly;
 *   • a `split` expense REQUIRES cost_bearer_split_json (omit → 400) (§3.5);
 *   • list returns rows + a correct total; filters by category/cost_bearer/date;
 *   • update mutates an expense (operational data, not the append-only ledger);
 *   • a Writer (no expenses perm) is 403 on POST and GET (server-side authz);
 *   • each create writes an immutable audit row (CLAUDE.md §4 provenance).
 * Requires FEATURE_EXPENSES=true so /expenses mounts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3216; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // capture/work view+create, NO expenses
const ORG = "00000000-0000-4000-8000-000000000001";
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";
const EMON_PARTY = "00000000-0000-4000-8000-0000000000c2";
const ANTU_PARTY = "00000000-0000-4000-8000-00000000ca01"; // a 3rd partner, created for this run

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = "";
let writerToken = "";

const createdUserIds: string[] = [];
const createdExpenseIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_EXPENSES: "true" },
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

async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `m6exp+${randomUUID()}@fathomxo.test`;
  const body: Record<string, unknown> = { email, password: DEV_PASSWORD };
  if (partyId) body.partyId = partyId;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId };
}

async function createExpense(body: Record<string, unknown>, token = mominToken) {
  const res = await api(BASE, "/expenses", { method: "POST", token, body });
  if (res.status === 201 && res.body?.id) createdExpenseIds.push(res.body.id);
  return res;
}

before(async () => {
  await admin.connect();
  // A third partner (beyond seeded Momin/Emon) to prove N-partner cost attribution.
  await admin.query(
    "insert into party (id, org_id, display_name, party_type) values ($1,$2,'Antu QA','{partner}') on conflict (id) do nothing",
    [ANTU_PARTY, ORG],
  );
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  // A fresh Writer-only login: holds capture/work but NOT expenses.
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE));
});

after(async () => {
  for (const id of createdExpenseIds) {
    await admin.query("delete from audit_log where entity='expense' and entity_id=$1", [id]);
    await admin.query("delete from expense where id=$1", [id]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  await admin.query("delete from party where id=$1", [ANTU_PARTY]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── Cost-bearer flavors ─────────────────────────────────────────────────────────

describe("expense cost-bearer flavors — party ref, N-partner (§3.5/§8, 0036)", () => {
  it("salary borne by a party (Momin) creates + echoes the bearer party", async () => {
    const res = await createExpense({
      category: "salary",
      amount: 30000,
      incurredAt: "2026-06-01",
      costBearer: "party",
      bearerPartyId: MOMIN_PARTY,
      payeePartyId: MOMIN_PARTY,
      note: "June salary",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.category, "salary");
    assert.equal(res.body.costBearer, "party");
    assert.equal(res.body.bearerPartyId, MOMIN_PARTY);
  });

  it("cost borne by a THIRD partner (Antu) creates — N-partner attribution", async () => {
    const res = await createExpense({
      category: "subscription",
      amount: 1200,
      incurredAt: "2026-06-02",
      costBearer: "party",
      bearerPartyId: ANTU_PARTY,
      note: "Antu's tool",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.bearerPartyId, ANTU_PARTY);
  });

  it("cost_bearer='party' WITHOUT bearerPartyId → 400", async () => {
    const res = await createExpense({ category: "other", amount: 100, incurredAt: "2026-06-02", costBearer: "party" });
    assert.equal(res.status, 400, "party bearer requires a bearerPartyId");
  });

  it("promo borne by Emon with campaign_tag + revenue_link creates", async () => {
    const res = await createExpense({
      category: "promo",
      amount: 5000,
      incurredAt: "2026-06-03",
      costBearer: "party",
      bearerPartyId: EMON_PARTY,
      campaignTag: "spring-fb",
      revenueLinkId: randomUUID(),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.campaignTag, "spring-fb");
    assert.ok(res.body.revenueLinkId, "revenue link is retained");
  });

  it("a writer-borne loss creates (no bearer party needed)", async () => {
    const res = await createExpense({
      category: "loss",
      amount: 2500,
      incurredAt: "2026-06-04",
      costBearer: "writer",
      note: "refunded client",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.category, "loss");
    assert.equal(res.body.costBearer, "writer");
  });

  it("the retired identity values (momin/emon) are rejected → 400", async () => {
    const res = await createExpense({ category: "other", amount: 1, incurredAt: "2026-06-01", costBearer: "momin" });
    assert.equal(res.status, 400, "momin is no longer a valid cost_bearer");
  });
});

// ─── Split validation (keyed by party UUID, N-way) ─────────────────────────────────

describe("split cost-bearer validation — party-UUID keys (§3.5, 0036)", () => {
  it("a 3-way split keyed by party UUIDs creates", async () => {
    const split = { [MOMIN_PARTY]: 0.5, [EMON_PARTY]: 0.3, [ANTU_PARTY]: 0.2 };
    const res = await createExpense({
      category: "subscription",
      amount: 1000,
      incurredAt: "2026-06-05",
      costBearer: "split",
      costBearerSplitJson: split,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.costBearerSplitJson, split);
  });

  it("a split WITHOUT cost_bearer_split_json → 400", async () => {
    const res = await createExpense({ category: "subscription", amount: 1000, incurredAt: "2026-06-05", costBearer: "split" });
    assert.equal(res.status, 400, "a split must carry its split json");
  });

  it("a split keyed by non-UUID names (the old momin/emon shape) → 400", async () => {
    const res = await createExpense({
      category: "subscription",
      amount: 1000,
      incurredAt: "2026-06-05",
      costBearer: "split",
      costBearerSplitJson: { momin: 0.5, emon: 0.5 },
    });
    assert.equal(res.status, 400, "split keys must be party UUIDs now");
  });

  it("a split keyed by an unknown/out-of-org party UUID → 400", async () => {
    const res = await createExpense({
      category: "subscription",
      amount: 1000,
      incurredAt: "2026-06-05",
      costBearer: "split",
      costBearerSplitJson: { [MOMIN_PARTY]: 0.5, [randomUUID()]: 0.5 },
    });
    assert.equal(res.status, 400, "every split party must exist in this org");
  });
});

// ─── List / filter / total ───────────────────────────────────────────────────────

describe("list returns rows + a correct total; filters apply", () => {
  it("list returns all created expenses with a summed total", async () => {
    const res = await api(BASE, "/expenses", { token: mominToken });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.expenses), "expenses is an array");
    assert.ok(typeof res.body.total === "number" || typeof res.body.total === "string", "a total is returned");
    // The total must equal the sum of the listed rows (derived, not fabricated).
    const sum = (res.body.expenses as Array<any>).reduce((a, r) => a + Number(r.amount), 0);
    assert.equal(Number(res.body.total), Math.round(sum * 100) / 100, "total = Σ listed amounts");
  });

  it("filter by category=loss returns only loss rows", async () => {
    const res = await api(BASE, "/expenses?category=loss", { token: mominToken });
    assert.equal(res.status, 200);
    assert.ok((res.body.expenses as Array<any>).length >= 1);
    for (const r of res.body.expenses) assert.equal(r.category, "loss");
  });

  it("filter by cost_bearer=party returns only party rows", async () => {
    const res = await api(BASE, "/expenses?costBearer=party", { token: mominToken });
    assert.equal(res.status, 200);
    for (const r of res.body.expenses) assert.equal(r.costBearer, "party");
  });

  it("filter by date range narrows the set (from..to on incurred_at)", async () => {
    const res = await api(BASE, "/expenses?from=2026-06-03&to=2026-06-04", { token: mominToken });
    assert.equal(res.status, 200);
    for (const r of res.body.expenses) {
      const d = String(r.incurredAt).slice(0, 10);
      assert.ok(d >= "2026-06-03" && d <= "2026-06-04", `row ${d} within range`);
    }
  });

  it("a malformed date filter → 400 (boundary validation)", async () => {
    const res = await api(BASE, "/expenses?from=not-a-date", { token: mominToken });
    assert.equal(res.status, 400);
  });
});

// ─── Update ──────────────────────────────────────────────────────────────────────

describe("update an expense (operational, mutable — not the money ledger)", () => {
  it("PATCH amends amount + note", async () => {
    const created = await createExpense({
      category: "other",
      amount: 100,
      incurredAt: "2026-06-10",
      costBearer: "writer",
    });
    assert.equal(created.status, 201);
    const res = await api(BASE, `/expenses/${created.body.id}`, {
      method: "PATCH",
      token: mominToken,
      body: { amount: 175, note: "corrected" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(Number(res.body.amount), 175);
    assert.equal(res.body.note, "corrected");
  });

  it("PATCH to cost_bearer=split WITHOUT a split json → 400", async () => {
    const created = await createExpense({
      category: "other",
      amount: 100,
      incurredAt: "2026-06-10",
      costBearer: "writer",
    });
    const res = await api(BASE, `/expenses/${created.body.id}`, {
      method: "PATCH",
      token: mominToken,
      body: { costBearer: "split" },
    });
    assert.equal(res.status, 400, "switching to split requires a split json");
  });
});

// ─── Server-side authz (a Writer has no expenses perm) ─────────────────────────────

describe("server-side authz — a Writer (no expenses perm) is blocked", () => {
  it("Writer POST /expenses → 403", async () => {
    const res = await api(BASE, "/expenses", {
      method: "POST",
      token: writerToken,
      body: { category: "other", amount: 1, incurredAt: "2026-06-01", costBearer: "writer" },
    });
    assert.equal(res.status, 403, "creating an expense requires expenses:create");
  });

  it("Writer GET /expenses → 403", async () => {
    const res = await api(BASE, "/expenses", { token: writerToken });
    assert.equal(res.status, 403, "viewing expenses requires expenses:view");
  });
});

// ─── Boundary validation ───────────────────────────────────────────────────────────

describe("boundary validation (treat client input as hostile)", () => {
  it("out-of-enum category → 400", async () => {
    const res = await createExpense({ category: "bribe", amount: 1, incurredAt: "2026-06-01", costBearer: "writer" });
    assert.equal(res.status, 400);
  });

  it("negative amount → 400 (Min(0))", async () => {
    const res = await createExpense({ category: "other", amount: -5, incurredAt: "2026-06-01", costBearer: "writer" });
    assert.equal(res.status, 400);
  });

  it("out-of-enum cost_bearer → 400", async () => {
    const res = await createExpense({ category: "other", amount: 1, incurredAt: "2026-06-01", costBearer: "santa" });
    assert.equal(res.status, 400);
  });

  it("GET /expenses/:id with a non-uuid → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/expenses/not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });
});

// ─── Audit provenance ─────────────────────────────────────────────────────────────

describe("each create writes an immutable audit row (CLAUDE.md §4)", () => {
  it("an expense.created audit row exists for a new expense", async () => {
    const created = await createExpense({
      category: "event",
      amount: 4000,
      incurredAt: "2026-06-20",
      costBearer: "writer",
    });
    assert.equal(created.status, 201);
    const audit = await admin.query(
      "select count(*)::int n from audit_log where action='expense.created' and entity_id=$1",
      [created.body.id],
    );
    assert.ok(audit.rows[0].n >= 1, "the create must be audited");
  });
});
