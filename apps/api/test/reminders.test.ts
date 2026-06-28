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
 * Subscription reminders (§8) — BLACK-BOX HTTP against the COMPILED app
 * (dist/main.js) with the `dev` EmailService adapter writing to a fresh outbox.
 * Proves ReminderService.runForOrg via POST /expenses/reminders/run:
 *   • a subscription due in exactly LEAD_DAYS (today+3) fires ONE email to the
 *     created_by user (subject carries currency + amount + due date);
 *   • last_reminded_due is stamped to next_due_date (read via admin pg);
 *   • a second run is idempotent ({sent:0}, no second email);
 *   • subscriptions due in 2 or 4 days are NOT included (exact lead window);
 *   • a created_by user with no email is skipped (not counted, not an error);
 *   • the endpoint is gated expenses:approve (a non-approver → 403).
 * Requires FEATURE_EXPENSES=true, EMAIL_ADAPTER=dev, EMAIL_OUTBOX_DIR set.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3233; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";

// Role a6 = Writer (NO expenses perms) — used for the authz-denied case.
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6";

const OUTBOX = mkdtempSync(join(tmpdir(), "bos-outbox-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin (expenses:approve), seeded email momin@fathomxo.local
let writerToken = ""; // a fresh Writer (no expenses perms)

const createdUserIds: string[] = [];
const createdExpenseIds: string[] = [];

// PG's current_date (set in before) — the runner compares against it, so the test
// must base its dates on the SAME calendar (the DB session tz, not the machine's).
let pgToday = "";
/** A YYYY-MM-DD date N days from PG's current_date (pure UTC date math). */
function localDatePlus(days: number): string {
  const d = new Date(`${pgToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** dd/mm/yyyy — matches shared formatDate() used in the email subject. */
function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
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

async function login(email: string, password: string) {
  return api(BASE, "/auth/login", { method: "POST", body: { email, password } });
}

async function makeUser(roleId: string): Promise<{ token: string; userId: string; email: string }> {
  const email = `rem+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD } });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId, email };
}

async function createSubscription(token: string, opts: { nextDueDate: string; currency?: string; amount?: number }) {
  const body: Record<string, unknown> = {
    category: "subscription",
    amount: opts.amount ?? 1200,
    incurredAt: localDatePlus(-30),
    costBearer: "emon",
    nextDueDate: opts.nextDueDate,
  };
  if (opts.currency) body.currency = opts.currency;
  const res = await api(BASE, "/expenses", { method: "POST", token, body });
  assert.equal(res.status, 201, `subscription create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdExpenseIds.push(res.body.id);
  return res.body.id as string;
}

function outboxFiles(): Array<{ name: string; msg: any }> {
  return readdirSync(OUTBOX)
    .filter((f) => f.endsWith(".json"))
    .map((name) => ({ name, msg: JSON.parse(readFileSync(join(OUTBOX, name), "utf8")) }));
}

async function lastRemindedDue(expenseId: string): Promise<string | null> {
  const r = await admin.query("select to_char(last_reminded_due,'YYYY-MM-DD') d from expense where id=$1", [expenseId]);
  return r.rows[0]?.d ?? null;
}

async function runReminders(token: string) {
  return api(BASE, "/expenses/reminders/run", { method: "POST", token });
}

before(async () => {
  await admin.connect();
  pgToday = (await admin.query("select current_date::text as d")).rows[0].d as string;
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200);
  sysToken = s.body.accessToken;
  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;

  ({ token: writerToken } = await makeUser(WRITER_ROLE));

  // Guard determinism: clear any pre-existing subscription already due today+3 in
  // this org so the org-wide sweep's `sent` count reflects only our fixtures.
  await admin.query(
    `update expense set last_reminded_due = next_due_date
       where org_id = $1 and category = 'subscription' and archived_at is null
         and next_due_date = (current_date + 3)`,
    [ORG],
  );
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
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("subscription reminders — POST /expenses/reminders/run", () => {
  // Lazy: localDatePlus needs pgToday, set in the before hook (not at collection).
  let due3 = "";
  let sub3 = "";

  it("a subscription due in exactly 3 days fires ONE email to the created_by user", async () => {
    due3 = localDatePlus(3);
    sub3 = await createSubscription(mominToken, { nextDueDate: due3, currency: "USD", amount: 1200 });
    const res = await runReminders(mominToken);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.sent, 1, "exactly one reminder sent for the single due subscription");

    const files = outboxFiles();
    assert.equal(files.length, 1, "one email file written to the outbox");
    const { msg } = files[0];
    assert.equal(msg.to, "momin@fathomxo.local", "addressed to the created_by user's email");
    assert.match(msg.subject, /USD/, "subject names the currency");
    assert.match(msg.subject, /1200\.00/, "subject names the amount");
    assert.ok(msg.subject.includes(ddmmyyyy(due3)), `subject names the due date (${ddmmyyyy(due3)}): ${msg.subject}`);
  });

  it("last_reminded_due is stamped to next_due_date after the send", async () => {
    assert.equal(await lastRemindedDue(sub3), due3, "last_reminded_due = next_due_date");
  });

  it("a second run is idempotent — {sent:0} and no second email", async () => {
    const res = await runReminders(mominToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.sent, 0, "the already-reminded subscription does not re-fire");
    assert.equal(outboxFiles().length, 1, "no additional email written");
  });

  it("subscriptions due in 2 or 4 days are NOT included (exact 3-day lead window)", async () => {
    await createSubscription(mominToken, { nextDueDate: localDatePlus(2), currency: "BDT" });
    await createSubscription(mominToken, { nextDueDate: localDatePlus(4), currency: "BDT" });
    const res = await runReminders(mominToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.sent, 0, "only today+3 fires; today+2 and today+4 are out of window");
    assert.equal(outboxFiles().length, 1, "still no new email");
  });

  it("a subscription whose created_by user has no email is skipped (not counted, no error)", async () => {
    // Simulate a recipient-less subscription: null its created_by so the
    // LEFT JOIN to user_account yields no email (user_account.email is NOT NULL,
    // so the no-recipient path is reached via a missing created_by, not a null email).
    const sub = await createSubscription(mominToken, { nextDueDate: due3, currency: "EUR", amount: 50 });
    await admin.query("update expense set created_by = null where id=$1", [sub]);

    const res = await runReminders(mominToken);
    assert.equal(res.status, 201, "a missing recipient is a skip, not a 500");
    assert.equal(res.body.sent, 0, "the no-email subscription is skipped, not sent");
    assert.equal(outboxFiles().length, 1, "no email written for the recipient-less subscription");
    // It was NOT marked reminded (so a later fix-the-email re-run would still fire).
    assert.equal(await lastRemindedDue(sub), null, "an unsent reminder leaves last_reminded_due null");
  });

  it("the endpoint is gated expenses:approve — a Writer is denied (403)", async () => {
    const res = await runReminders(writerToken);
    assert.equal(res.status, 403, "running reminders requires expenses:approve");
  });
});
