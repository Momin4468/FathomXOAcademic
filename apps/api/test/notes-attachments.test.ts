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
 * Personal Note attachments (0028, §11) — BLACK-BOX HTTP. Covers the file rule
 * (DB keeps metadata + reference, never blobs): a LINK attachment (is_link=true,
 * url stored), an UPLOADED file (is_link=false, size>0, byte-exact download),
 * the "link → download 400" guard, DELETE removing it from the note, and the
 * cross-account guard (B cannot download or delete A's attachment → 404).
 *
 * NOTE: a successful upload writes a file under STORAGE_DIR (storage key). The
 * row is cleaned in `after`; the on-disk byte file is left (not critical).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3252;
const BASE = `http://localhost:${PORT}`;
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-notes-att-"));

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
    body: { email, password: "Password123!", displayName: "ATT", baseCurrency: "BDT" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const token = res.body.accessToken as string;
  const me = await api(BASE, "/pf/auth/me", { token });
  createdPfAccountIds.push(me.body.id as string);
  return { token, id: me.body.id as string, email };
}

/** Upload a file via real multipart (Node 20+ FormData/Blob); api() can't do this. */
async function uploadFile(token: string, noteId: string, name: string, bytes: Buffer, mime: string) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: mime }), name);
  const res = await fetch(`${BASE}/pf/notes/${noteId}/attachments`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }, // let fetch set the multipart boundary
    body: fd,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function newNote(token: string): Promise<string> {
  const res = await api(BASE, "/pf/notes", { method: "POST", token, body: { title: "with attachments" } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
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

describe("link attachments (external URL, never a blob)", () => {
  it("adds a link (is_link=true, url stored) and GET note returns it under attachments[]", async () => {
    const { token } = await registerPf();
    const noteId = await newNote(token);
    const link = await api(BASE, `/pf/notes/${noteId}/attachments/link`, {
      method: "POST",
      token,
      body: { url: "https://example.com/brief.pdf", filename: "brief.pdf" },
    });
    assert.equal(link.status, 201, JSON.stringify(link.body));
    assert.equal(link.body.isLink, true, "a link attachment is flagged is_link=true");
    assert.equal(link.body.url, "https://example.com/brief.pdf", "the external URL is stored verbatim");

    const note = await api(BASE, `/pf/notes/${noteId}`, { token });
    assert.equal(note.body.attachments.length, 1, "the link shows under the note's attachments[]");
    assert.equal(note.body.attachments[0].id, link.body.id);
  });

  it("rejects a non-http(s) link (boundary validation, 400)", async () => {
    const { token } = await registerPf();
    const noteId = await newNote(token);
    const res = await api(BASE, `/pf/notes/${noteId}/attachments/link`, {
      method: "POST",
      token,
      body: { url: "javascript:alert(1)" },
    });
    assert.equal(res.status, 400, "only http/https URLs accepted");
  });

  it("downloading a LINK attachment is refused (400 — open its URL directly)", async () => {
    const { token } = await registerPf();
    const noteId = await newNote(token);
    const link = await api(BASE, `/pf/notes/${noteId}/attachments/link`, {
      method: "POST",
      token,
      body: { url: "https://example.com/x.pdf" },
    });
    const res = await fetch(`${BASE}/pf/attachments/${link.body.id}/download`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 400, "a link cannot be streamed");
    const body = await res.json();
    assert.match(JSON.stringify(body), /open its URL directly/i, "the 400 explains why");
  });
});

describe("uploaded files (stored bytes, byte-exact download)", () => {
  it("uploads a small text file (is_link=false, size>0) and download returns the EXACT bytes", async () => {
    const { token } = await registerPf();
    const noteId = await newNote(token);
    const content = Buffer.from(`hello notes ${randomUUID()}\nline two\n`, "utf8");

    const up = await uploadFile(token, noteId, "memo.txt", content, "text/plain");
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.isLink, false, "an uploaded file is is_link=false");
    assert.ok(Number(up.body.sizeBytes) > 0, "size_bytes recorded");
    assert.equal(Number(up.body.sizeBytes), content.length, "size matches the uploaded byte count");

    const dl = await fetch(`${BASE}/pf/attachments/${up.body.id}/download`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(dl.status, 200, "download streams the stored file");
    const got = Buffer.from(await dl.arrayBuffer());
    assert.ok(got.equals(content), "downloaded bytes are byte-for-byte identical to what was uploaded");
  });

  it("DELETE removes the attachment from the note", async () => {
    const { token } = await registerPf();
    const noteId = await newNote(token);
    const up = await uploadFile(token, noteId, "d.txt", Buffer.from("delete me"), "text/plain");
    const attId = up.body.id as string;

    const del = await fetch(`${BASE}/pf/attachments/${attId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(del.status, 200, "delete succeeds");

    const note = await api(BASE, `/pf/notes/${noteId}`, { token });
    assert.ok(!note.body.attachments.some((a: any) => a.id === attId), "the attachment is gone from the note");

    const dl = await fetch(`${BASE}/pf/attachments/${attId}/download`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(dl.status, 404, "the deleted attachment can no longer be downloaded");
  });
});

describe("attachments are account-isolated", () => {
  it("B cannot download A's attachment (404) nor delete it (404)", async () => {
    const a = await registerPf();
    const b = await registerPf();
    const noteId = await newNote(a.token);
    const up = await uploadFile(a.token, noteId, "private.txt", Buffer.from("A's private file"), "text/plain");
    const attId = up.body.id as string;

    const bDownload = await fetch(`${BASE}/pf/attachments/${attId}/download`, {
      headers: { authorization: `Bearer ${b.token}` },
    });
    assert.equal(bDownload.status, 404, "B cannot download A's attachment");

    const bDelete = await fetch(`${BASE}/pf/attachments/${attId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${b.token}` },
    });
    assert.equal(bDelete.status, 404, "B cannot delete A's attachment");

    // A's attachment still works (no cross-account side effect).
    const aDownload = await fetch(`${BASE}/pf/attachments/${attId}/download`, {
      headers: { authorization: `Bearer ${a.token}` },
    });
    assert.equal(aDownload.status, 200, "A's attachment survives B's attempts");
  });
});
