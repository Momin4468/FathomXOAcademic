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
 * Personal Notes isolation + plane separation (§11, §4.1) — BLACK-BOX HTTP.
 * The privacy guarantee that must never break: a note lives in ONE pf_account's
 * private plane. Account A sees only A's notes; B's note id is invisible to A
 * (404, not a cross-account read/mutation); a missing or business token is 401.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3251;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-notes-iso-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
const createdPfAccountIds: string[] = [];
let mominToken = ""; // a BUSINESS token

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
  await startServer();
  const m = await api(BASE, "/auth/login", { method: "POST", body: { email: "momin@fathomxo.local", password: DEV_PASSWORD } });
  assert.equal(m.status, 200, "momin (business) should log in");
  mominToken = m.body.accessToken;
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

describe("account A and account B notes are isolated", () => {
  it("A's list shows only A's notes; B's notes are invisible (zero leak)", async () => {
    const a = await registerPf();
    const b = await registerPf();
    await api(BASE, "/pf/notes", { method: "POST", token: a.token, body: { title: "A-secret" } });
    await api(BASE, "/pf/notes", { method: "POST", token: b.token, body: { title: "B-secret" } });

    const aList = (await api(BASE, "/pf/notes", { token: a.token })).body as Array<any>;
    assert.equal(aList.length, 1, "A sees exactly its own note");
    assert.equal(aList[0].title, "A-secret");
    assert.ok(!aList.some((n) => n.title === "B-secret"), "A never sees B's note");
  });

  it("A cannot GET / PATCH / archive B's note id (404, not a cross-account op)", async () => {
    const a = await registerPf();
    const b = await registerPf();
    const bNote = await api(BASE, "/pf/notes", { method: "POST", token: b.token, body: { title: "B-only" } });
    const bId = bNote.body.id as string;

    const get = await api(BASE, `/pf/notes/${bId}`, { token: a.token });
    assert.equal(get.status, 404, "A cannot read B's note");

    const patch = await api(BASE, `/pf/notes/${bId}`, { method: "PATCH", token: a.token, body: { title: "hijacked" } });
    assert.equal(patch.status, 404, "A cannot edit B's note");

    const archive = await api(BASE, `/pf/notes/${bId}/archive`, { method: "POST", token: a.token });
    assert.equal(archive.status, 404, "A cannot archive B's note");

    // B's note is untouched.
    const bGet = await api(BASE, `/pf/notes/${bId}`, { token: b.token });
    assert.equal(bGet.status, 200);
    assert.equal(bGet.body.title, "B-only", "B's note title unchanged by A's attempts");
    assert.equal(bGet.body.archivedAt ?? null, null, "B's note not archived by A");
  });
});

describe("the notes endpoints require a PF token", () => {
  it("no bearer at all → 401", async () => {
    const res = await api(BASE, "/pf/notes", {});
    assert.equal(res.status, 401, "a PF endpoint requires a PF bearer token");
  });

  it("a BUSINESS token on /pf/notes → 401", async () => {
    const res = await api(BASE, "/pf/notes", { token: mominToken });
    assert.equal(res.status, 401, "PfAuthGuard rejects a business token on notes");
  });
});
