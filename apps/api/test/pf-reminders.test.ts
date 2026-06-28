import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { api, waitForHealth } from "./helpers.js";

/**
 * PF subscription reminders (DESIGN_SPEC §11) — BLACK-BOX HTTP, dev EmailService
 * writing to a fresh outbox. Mirrors the business reminder runner but per PF
 * ACCOUNT. Proves POST /pf/subscriptions/reminders/run:
 *   • a subscription due in exactly LEAD_DAYS (today+3) fires ONE email to the
 *     account's own email;
 *   • last_reminded_due is stamped → a second run is idempotent ({sent:0});
 *   • due-in-2 and due-in-4 are NOT in the window;
 *   • the run is account-scoped (another account's due sub never fires here).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3242;
const BASE = `http://localhost:${PORT}`;
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-pf-rem-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

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
    body: { email, password: "Password123!", displayName: "REM", baseCurrency: "BDT" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const token = res.body.accessToken as string;
  const me = await api(BASE, "/pf/auth/me", { token });
  createdPfAccountIds.push(me.body.id as string);
  return { token, id: me.body.id as string, email };
}

function outboxFiles(): Array<{ name: string; msg: any }> {
  return readdirSync(OUTBOX)
    .filter((f) => f.endsWith(".json"))
    .map((name) => ({ name, msg: JSON.parse(readFileSync(join(OUTBOX, name), "utf8")) }));
}

async function makeSub(token: string, nextDueDate: string, opts: { amount?: number; currency?: string; name?: string } = {}) {
  const res = await api(BASE, "/pf/subscriptions", {
    method: "POST",
    token,
    body: { name: opts.name ?? "Netflix", amount: opts.amount ?? 1200, currency: opts.currency ?? "BDT", nextDueDate },
  });
  assert.equal(res.status, 201, `create subscription (got ${res.status}: ${JSON.stringify(res.body)})`);
  return res.body.id as string;
}

async function run(token: string) {
  return api(BASE, "/pf/subscriptions/reminders/run", { method: "POST", token });
}

before(async () => {
  await admin.connect();
  pgToday = (await admin.query("select current_date::text as d")).rows[0].d as string;
  await startServer();
});

after(async () => {
  for (const id of createdPfAccountIds) {
    await admin.query("delete from pf_subscription where pf_account_id=$1", [id]);
    await admin.query("delete from pf_category where pf_account_id=$1", [id]);
    await admin.query("delete from pf_audit_log where pf_account_id=$1", [id]);
    await admin.query("delete from pf_refresh_token where pf_account_id=$1", [id]);
    await admin.query("delete from pf_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("POST /pf/subscriptions/reminders/run — 3-day lead window, idempotent", () => {
  it("due in exactly 3 days fires ONE email to the account's own email; a second run sends 0", async () => {
    const acct = await registerPf();
    const due3 = datePlus(3);
    const subId = await makeSub(acct.token, due3, { amount: 1200, currency: "USD", name: "Spotify" });

    // due-in-2 and due-in-4 must NOT fire.
    await makeSub(acct.token, datePlus(2), { name: "Too soon" });
    await makeSub(acct.token, datePlus(4), { name: "Too late" });

    const res1 = await run(acct.token);
    assert.equal(res1.status, 201, JSON.stringify(res1.body));
    assert.equal(res1.body.sent, 1, "exactly one reminder fires (only today+3)");

    const mine = outboxFiles().filter((f) => f.msg.to === acct.email);
    assert.equal(mine.length, 1, "one email addressed to the account's own email");
    assert.match(mine[0].msg.subject, /Spotify/, "subject names the subscription");
    assert.match(mine[0].msg.subject, /USD/, "subject names the currency");
    assert.match(mine[0].msg.subject, /1200/, "subject names the amount");

    // last_reminded_due stamped → idempotent.
    const stamped = await admin.query(
      "select to_char(last_reminded_due,'YYYY-MM-DD') d from pf_subscription where id=$1",
      [subId],
    );
    assert.equal(stamped.rows[0].d, due3, "last_reminded_due = next_due_date after the send");

    const res2 = await run(acct.token);
    assert.equal(res2.status, 201);
    assert.equal(res2.body.sent, 0, "a second run is idempotent — already reminded");
    assert.equal(outboxFiles().filter((f) => f.msg.to === acct.email).length, 1, "no second email");
  });

  it("the run is account-scoped: another account's due subscription does not fire here", async () => {
    const a = await registerPf();
    const b = await registerPf();
    // B has a due-in-3 sub; running A's reminders must not touch it.
    await makeSub(b.token, datePlus(3), { name: "B's sub" });

    const res = await run(a.token);
    assert.equal(res.status, 201);
    assert.equal(res.body.sent, 0, "A's run sends nothing — B's sub is in B's plane only");
    assert.equal(outboxFiles().filter((f) => f.msg.to === a.email).length, 0, "no email to A");

    // And B's own run still works.
    const resB = await run(b.token);
    assert.equal(resB.body.sent, 1, "B's own run fires B's due sub");
  });
});
