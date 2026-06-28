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
 * Personal Notes (migration 0028, PF private plane §11) — BLACK-BOX HTTP against
 * the COMPILED app with FEATURE_PERSONAL_FINANCE on. Proves the editable-scratch
 * model: CRUD, a checklist that persists across a PATCH, pinned-first ordering,
 * title/body ILIKE search, and the archive↔restore soft-delete lifecycle.
 *
 * Notes are NOT a money ledger, so (unlike pf_income) UPDATE is allowed here — we
 * assert the edit actually persists rather than that it is rejected.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3250; // dedicated test port (one file per process)
const BASE = `http://localhost:${PORT}`;
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-notes-core-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
const createdPfAccountIds: string[] = [];

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
    body: { email, password: "Password123!", displayName: "NOTES", baseCurrency: "BDT" },
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

describe("create / read with checklist + color + pinned", () => {
  it("creates a 2-item checklist note and GET returns it intact", async () => {
    const { token } = await registerPf();
    const create = await api(BASE, "/pf/notes", {
      method: "POST",
      token,
      body: {
        title: "Groceries",
        body: "weekend run",
        color: "yellow",
        pinned: true,
        items: [
          { text: "milk", done: false },
          { text: "eggs", done: true },
        ],
      },
    });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    const id = create.body.id as string;
    assert.equal(create.body.title, "Groceries");
    assert.equal(create.body.color, "yellow");
    assert.equal(create.body.pinned, true);
    assert.equal((create.body.items as Array<unknown>).length, 2, "both checklist items stored");

    const get = await api(BASE, `/pf/notes/${id}`, { token });
    assert.equal(get.status, 200, JSON.stringify(get.body));
    assert.equal(get.body.title, "Groceries");
    assert.equal(get.body.body, "weekend run");
    assert.deepEqual(get.body.items, [
      { text: "milk", done: false },
      { text: "eggs", done: true },
    ], "checklist round-trips exactly");
    assert.ok(Array.isArray(get.body.attachments), "GET :id includes an attachments[] array");
    assert.equal(get.body.attachments.length, 0, "no attachments yet");
  });

  it("rejects an out-of-palette color (boundary validation, 400)", async () => {
    const { token } = await registerPf();
    const res = await api(BASE, "/pf/notes", { method: "POST", token, body: { title: "x", color: "rainbow" } });
    assert.equal(res.status, 400, "color must be in NOTE_COLORS");
  });

  it("rejects a malformed checklist item (item.done must be boolean, 400)", async () => {
    const { token } = await registerPf();
    const res = await api(BASE, "/pf/notes", {
      method: "POST",
      token,
      body: { items: [{ text: "bad", done: "yes" }] },
    });
    assert.equal(res.status, 400, "nested item validation rejects a non-boolean done");
  });
});

describe("PATCH persists (notes are editable scratch, not a ledger)", () => {
  it("toggling a checklist item via PATCH replaces the list and persists", async () => {
    const { token } = await registerPf();
    const create = await api(BASE, "/pf/notes", {
      method: "POST",
      token,
      body: { title: "todo", items: [{ text: "task A", done: false }] },
    });
    const id = create.body.id as string;

    const patch = await api(BASE, `/pf/notes/${id}`, {
      method: "PATCH",
      token,
      body: { items: [{ text: "task A", done: true }, { text: "task B", done: false }] },
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));

    const get = await api(BASE, `/pf/notes/${id}`, { token });
    assert.deepEqual(get.body.items, [
      { text: "task A", done: true },
      { text: "task B", done: false },
    ], "sending items REPLACES the checklist (toggle persisted)");
  });
});

describe("listing: pinned first, then search", () => {
  it("pinned notes sort ahead of unpinned in the active list", async () => {
    const { token } = await registerPf();
    await api(BASE, "/pf/notes", { method: "POST", token, body: { title: "plain-1", pinned: false } });
    const pinnedRes = await api(BASE, "/pf/notes", { method: "POST", token, body: { title: "pinned-1", pinned: true } });
    await api(BASE, "/pf/notes", { method: "POST", token, body: { title: "plain-2", pinned: false } });

    const list = (await api(BASE, "/pf/notes", { token })).body as Array<any>;
    assert.equal(list.length, 3, "all three active notes listed");
    assert.equal(list[0].id, pinnedRes.body.id, "the pinned note is first");
    assert.equal(list[0].pinned, true);
  });

  it("?q= matches title/body (ILIKE) and excludes non-matches", async () => {
    const { token } = await registerPf();
    await api(BASE, "/pf/notes", { method: "POST", token, body: { title: "Mango season", body: "buy crates" } });
    await api(BASE, "/pf/notes", { method: "POST", token, body: { title: "Random", body: "a MANGO smoothie recipe" } });
    await api(BASE, "/pf/notes", { method: "POST", token, body: { title: "Unrelated", body: "nothing here" } });

    const hits = (await api(BASE, "/pf/notes?q=mango", { token })).body as Array<any>;
    assert.equal(hits.length, 2, "matches by title AND body, case-insensitive");
    assert.ok(hits.every((n) => /mango/i.test(`${n.title} ${n.body}`)), "every hit actually contains the term");
    assert.ok(!hits.some((n) => n.title === "Unrelated"), "non-matching note excluded");
  });
});

describe("archive removes from active, restore brings back", () => {
  it("archive → absent from active, present under ?archived=true; restore → back", async () => {
    const { token } = await registerPf();
    const create = await api(BASE, "/pf/notes", { method: "POST", token, body: { title: "ephemeral" } });
    const id = create.body.id as string;

    const archive = await api(BASE, `/pf/notes/${id}/archive`, { method: "POST", token });
    assert.equal(archive.status, 201, JSON.stringify(archive.body));

    const active = (await api(BASE, "/pf/notes", { token })).body as Array<any>;
    assert.ok(!active.some((n) => n.id === id), "archived note is gone from the active list");

    const archived = (await api(BASE, "/pf/notes?archived=true", { token })).body as Array<any>;
    assert.ok(archived.some((n) => n.id === id), "archived note appears under ?archived=true");

    const restore = await api(BASE, `/pf/notes/${id}/restore`, { method: "POST", token });
    assert.equal(restore.status, 201, JSON.stringify(restore.body));

    const activeAgain = (await api(BASE, "/pf/notes", { token })).body as Array<any>;
    assert.ok(activeAgain.some((n) => n.id === id), "restore returns it to the active list");
  });
});
