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
 * Personal Note reminders (0028, §11) — BLACK-BOX HTTP, dev EmailService → fresh
 * outbox. POST /pf/notes/reminders/run fires ONE email per note whose remind_on
 * = PG current_date, to the account's OWN email; stamps last_reminded_on so a
 * second run is idempotent ({sent:0}); a note due tomorrow/yesterday does NOT
 * fire; and the run is account-scoped (A's run never emails B).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3253;
const BASE = `http://localhost:${PORT}`;
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-notes-rem-"));

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

async function makeNote(token: string, body: Record<string, unknown>): Promise<string> {
  const res = await api(BASE, "/pf/notes", { method: "POST", token, body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

async function run(token: string) {
  return api(BASE, "/pf/notes/reminders/run", { method: "POST", token });
}

before(async () => {
  await admin.connect();
  pgToday = (await admin.query("select current_date::text as d")).rows[0].d as string;
  await startServer();
});

after(async () => {
  for (const id of createdPfAccountIds) {
    await admin.query("delete from pf_note_attachment where pf_account_id=$1", [id]);
    await admin.query("delete from pf_note where pf_account_id=$1", [id]);
    await admin.query("delete from pf_category where pf_account_id=$1", [id]);
    await admin.query("delete from pf_audit_log where pf_account_id=$1", [id]);
    await admin.query("delete from pf_refresh_token where pf_account_id=$1", [id]);
    await admin.query("delete from pf_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("POST /pf/notes/reminders/run — fires on remind_on = today, idempotent", () => {
  it("a note due TODAY emails the account once; second run sends 0; due ±1 day never fires", async () => {
    const acct = await registerPf();
    const dueToday = await makeNote(acct.token, { title: "Pay rent", body: "transfer to landlord", remindOn: pgToday });
    // Neighbours that must NOT fire.
    await makeNote(acct.token, { title: "tomorrow", remindOn: datePlus(1) });
    await makeNote(acct.token, { title: "yesterday", remindOn: datePlus(-1) });

    const res1 = await run(acct.token);
    assert.equal(res1.status, 201, JSON.stringify(res1.body));
    assert.equal(res1.body.sent, 1, "exactly one reminder fires (only remind_on = current_date)");

    const mine = outboxFiles().filter((f) => f.msg.to === acct.email);
    assert.equal(mine.length, 1, "one email addressed to the account's own email");
    assert.match(mine[0].msg.subject, /^Reminder:/, "subject begins with 'Reminder:'");
    assert.match(mine[0].msg.subject, /Pay rent/, "subject names the note title");

    // last_reminded_on stamped → idempotent.
    const stamped = await admin.query(
      "select to_char(last_reminded_on,'YYYY-MM-DD') d from pf_note where id=$1",
      [dueToday],
    );
    assert.equal(stamped.rows[0].d, pgToday, "last_reminded_on = remind_on after the send");

    const res2 = await run(acct.token);
    assert.equal(res2.status, 201);
    assert.equal(res2.body.sent, 0, "a second run is idempotent — already reminded");
    assert.equal(outboxFiles().filter((f) => f.msg.to === acct.email).length, 1, "no second email");
  });

  it("changing remind_on re-arms the note (PATCH resets last_reminded_on)", async () => {
    const acct = await registerPf();
    const id = await makeNote(acct.token, { title: "Re-arm me", remindOn: pgToday });

    const first = await run(acct.token);
    assert.equal(first.body.sent, 1, "fires once for today");

    // Move it off today, then back onto today → last_reminded_on resets, fires again.
    const off = await api(BASE, `/pf/notes/${id}`, { method: "PATCH", token: acct.token, body: { remindOn: datePlus(5) } });
    assert.equal(off.status, 200);
    const back = await api(BASE, `/pf/notes/${id}`, { method: "PATCH", token: acct.token, body: { remindOn: pgToday } });
    assert.equal(back.status, 200);

    const stamped = await admin.query("select last_reminded_on from pf_note where id=$1", [id]);
    assert.equal(stamped.rows[0].last_reminded_on, null, "changing remind_on cleared last_reminded_on");

    const again = await run(acct.token);
    assert.equal(again.body.sent, 1, "the re-armed note fires again");
  });

  it("the run is account-scoped: A's run never emails B", async () => {
    const a = await registerPf();
    const b = await registerPf();
    await makeNote(b.token, { title: "B's due note", remindOn: pgToday });

    const res = await run(a.token);
    assert.equal(res.status, 201);
    assert.equal(res.body.sent, 0, "A's run sends nothing — B's note is in B's plane only");
    assert.equal(outboxFiles().filter((f) => f.msg.to === a.email).length, 0, "no email to A");
    assert.equal(outboxFiles().filter((f) => f.msg.to === b.email).length, 0, "B not emailed by A's run");

    const resB = await run(b.token);
    assert.equal(resB.body.sent, 1, "B's own run fires B's due note");
  });

  it("an archived note due today does NOT fire", async () => {
    const acct = await registerPf();
    const id = await makeNote(acct.token, { title: "archived due", remindOn: pgToday });
    const arch = await api(BASE, `/pf/notes/${id}/archive`, { method: "POST", token: acct.token });
    assert.equal(arch.status, 201);

    const res = await run(acct.token);
    assert.equal(res.body.sent, 0, "archived notes are excluded from reminders");
    assert.equal(outboxFiles().filter((f) => f.msg.to === acct.email).length, 0, "no email for an archived note");
  });
});
