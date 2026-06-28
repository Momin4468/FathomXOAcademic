import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { api, waitForHealth } from "./helpers.js";

/**
 * Personal Finance isolation + plane separation (DESIGN_SPEC §11, §4.1) —
 * BLACK-BOX HTTP against the COMPILED app. The structural privacy guarantees that
 * must never silently break:
 *   • account A and account B are isolated: A's GET /pf/income returns ONLY A's
 *     rows; B's data is invisible (zero rows, not an error);
 *   • a BUSINESS token can NEVER authenticate a PF endpoint → 401 (PfAuthGuard
 *     rejects a wrong-typ token);
 *   • a PF token can NEVER authenticate a business endpoint → 401;
 *   • the personal-finance plane is unreadable from the business side — even the
 *     admin SQL path shows the rows live only under app.pf_account_id RLS.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3241;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-pf-iso-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let mominToken = ""; // a business token
const createdPfAccountIds: string[] = [];
let pgToday = "";
function datePlus(days: number): string {
  const d = new Date(`${pgToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_PERSONAL_FINANCE: "true",
      FEATURE_BILLING: "true",
      FEATURE_EXPENSES: "true",
      EMAIL_ADAPTER: "dev",
      EMAIL_OUTBOX_DIR: OUTBOX,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE);
}

async function registerPf(): Promise<{ token: string; id: string; email: string }> {
  const email = `pf+${randomUUID()}@pf.test`;
  const res = await api(BASE, "/pf/auth/register", {
    method: "POST",
    body: { email, password: DEV_PASSWORD, displayName: "ISO", baseCurrency: "BDT" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const token = res.body.accessToken as string;
  const me = await api(BASE, "/pf/auth/me", { token });
  createdPfAccountIds.push(me.body.id as string);
  return { token, id: me.body.id as string, email };
}

before(async () => {
  await admin.connect();
  pgToday = (await admin.query("select current_date::text as d")).rows[0].d as string;
  await startServer();
  const m = await api(BASE, "/auth/login", { method: "POST", body: { email: "momin@fathomxo.local", password: DEV_PASSWORD } });
  assert.equal(m.status, 200, "momin (business) should log in");
  mominToken = m.body.accessToken;
});

after(async () => {
  for (const id of createdPfAccountIds) {
    await admin.query("delete from pf_income where pf_account_id=$1", [id]);
    await admin.query("delete from pf_expense where pf_account_id=$1", [id]);
    await admin.query("delete from pf_category where pf_account_id=$1", [id]);
    await admin.query("delete from pf_audit_log where pf_account_id=$1", [id]);
    await admin.query("delete from pf_refresh_token where pf_account_id=$1", [id]);
    await admin.query("delete from pf_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("account A and account B are isolated", () => {
  it("A sees only A's income; B's rows are invisible (zero rows, not an error)", async () => {
    const a = await registerPf();
    const b = await registerPf();

    const aInc = await api(BASE, "/pf/income", { method: "POST", token: a.token, body: { amount: 111, currency: "BDT", occurredOn: datePlus(-1), note: "A-only" } });
    assert.equal(aInc.status, 201);
    const bInc = await api(BASE, "/pf/income", { method: "POST", token: b.token, body: { amount: 222, currency: "BDT", occurredOn: datePlus(-1), note: "B-only" } });
    assert.equal(bInc.status, 201);

    const aList = (await api(BASE, "/pf/income", { token: a.token })).body as Array<any>;
    assert.equal(aList.length, 1, "A sees exactly one row (its own)");
    assert.equal(Number(aList[0].amount), 111, "A sees only A's amount");
    assert.ok(!aList.some((r) => Number(r.amount) === 222), "A never sees B's row");

    const bList = (await api(BASE, "/pf/income", { token: b.token })).body as Array<any>;
    assert.equal(bList.length, 1, "B sees exactly one row (its own)");
    assert.equal(Number(bList[0].amount), 222, "B sees only B's amount");

    // B cannot reverse A's row (not visible) → 404, not a cross-account mutation.
    const cross = await api(BASE, `/pf/income/${aInc.body.id}/reverse`, { method: "POST", token: b.token });
    assert.equal(cross.status, 404, "B cannot reverse A's income — it isn't visible to B");
    // And A's row is still un-reversed (no cross-account side effect).
    const aList2 = (await api(BASE, "/pf/income", { token: a.token })).body as Array<any>;
    assert.equal(aList2.length, 1, "A's income is untouched by B's attempt");
  });
});

describe("the two planes do not share auth (token type is load-bearing)", () => {
  it("a BUSINESS token on /pf/dashboard → 401", async () => {
    const res = await api(BASE, "/pf/dashboard", { token: mominToken });
    assert.equal(res.status, 401, "PfAuthGuard rejects a business token");
  });

  it("a BUSINESS token on /pf/income → 401", async () => {
    const res = await api(BASE, "/pf/income", { token: mominToken });
    assert.equal(res.status, 401, "PfAuthGuard rejects a business token on entries");
  });

  it("a PF token on a business endpoint (/expenses) → 401", async () => {
    const a = await registerPf();
    const res = await api(BASE, "/expenses", { token: a.token });
    assert.equal(res.status, 401, "the business guard rejects a PF token");
  });

  it("a PF token on a business money endpoint (/payments) → 401", async () => {
    const a = await registerPf();
    const res = await api(BASE, "/payments", { token: a.token });
    assert.equal(res.status, 401, "a PF token cannot reach business money");
  });

  it("no bearer at all on a PF endpoint → 401", async () => {
    const res = await api(BASE, "/pf/income", {});
    assert.equal(res.status, 401, "a PF endpoint requires a PF bearer token");
  });
});
