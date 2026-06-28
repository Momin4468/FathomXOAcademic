import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import sharp from "sharp";
import { api, waitForHealth } from "./helpers.js";

/**
 * File pipeline — BLACK-BOX HTTP against the COMPILED app (dist/main.js).
 * Proves the request-time guarantees of the file rule (DESIGN_SPEC §1/§11,
 * CLAUDE.md §4 file handling):
 *   • a small file uploads, returns metadata only, url=null (key never exposed)
 *   • 🔴 NO BLOB IN DB: file_object.url is an opaque storage key, not the bytes
 *   • download streams back the exact uploaded bytes
 *   • images are re-encoded (compression) on upload
 *   • 🔴 file rule: >10MB rejected; video rejected ("link"); link registered;
 *     a link downloads as a 302 redirect
 *   • an unauthenticated upload is 401
 * Requires STORAGE_DIR = a fresh temp dir + FEATURE_KNOWLEDGE so /files mounts
 * (FilesModule is always-on, but we boot with the same env as the kb suite).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3221; // dedicated test port for the file pipeline
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const STORAGE_DIR = mkdtempSync(join(tmpdir(), "bos-files-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let mominToken = "";
const createdFileIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_KNOWLEDGE: "true",
      STORAGE_DIR,
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

/** Multipart upload via global FormData/Blob — fetch sets the boundary itself. */
async function uploadFile(buf: Buffer | Uint8Array, name: string, type: string, kind: string, token?: string) {
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type }), name);
  fd.append("kind", kind);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/files`, { method: "POST", headers, body: fd });
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as any };
}

before(async () => {
  await admin.connect();
  await startServer();
  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;
});

after(async () => {
  for (const id of createdFileIds) {
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from file_object where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── 1. Upload metadata + 🔴 no blob in DB ───────────────────────────────────────

describe("upload small text file (metadata only, url=null)", () => {
  const TEXT = `hello business-os ${Date.now()}`;
  let fileId = "";

  it("momin POST /files (kind=knowledge) → 201, isLink=false, url=null, sizeBytes>0", async () => {
    const res = await uploadFile(Buffer.from(TEXT, "utf8"), "note.txt", "text/plain", "knowledge", mominToken);
    assert.equal(res.status, 201, `upload should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.isLink, false, "a stored file is not a link");
    assert.equal(res.body.url, null, "a stored file's storage key must NOT be exposed in metadata");
    assert.equal(res.body.kind, "knowledge");
    assert.equal(res.body.filename, "note.txt");
    assert.ok(res.body.sizeBytes > 0, "sizeBytes reflects stored bytes");
    assert.ok(res.body.id, "an id is returned");
    fileId = res.body.id;
    createdFileIds.push(fileId);
  });

  it("🔴 NO BLOB IN DB — file_object.url is an opaque uuid key, not the file contents", async () => {
    const { rows } = await admin.query<{ url: string | null }>("select url from file_object where id=$1", [fileId]);
    assert.equal(rows.length, 1, "the row exists");
    const url = rows[0].url ?? "";
    assert.match(url, /^[0-9a-f-]{36}$/i, `url must be a 36-char storage key (got: ${JSON.stringify(url)})`);
    assert.ok(!url.includes(TEXT), "the file contents must NOT be stored in the DB");
  });

  // ─── 2. Download returns the exact bytes ──
  it("GET /files/:id/download → 200 and the streamed bytes equal the uploaded text", async () => {
    const res = await fetch(`${BASE}/files/${fileId}/download`, { headers: { authorization: `Bearer ${mominToken}` } });
    assert.equal(res.status, 200, "download streams the stored file");
    const got = await res.text();
    assert.equal(got, TEXT, "downloaded bytes must equal what was uploaded");
  });
});

// ─── 3. Image compression ────────────────────────────────────────────────────────

describe("image upload is re-encoded (compression)", () => {
  it("upload a 1200x1200 PNG → 201; meta mime=image/png and sizeBytes>0", async () => {
    const png = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: { r: 200, g: 100, b: 50 } } })
      .png()
      .toBuffer();
    const up = await uploadFile(png, "pic.png", "image/png", "knowledge", mominToken);
    assert.equal(up.status, 201, `image upload should succeed (got ${up.status}: ${JSON.stringify(up.body)})`);
    const fileId = up.body.id as string;
    createdFileIds.push(fileId);

    const meta = await api(BASE, `/files/${fileId}`, { token: mominToken });
    assert.equal(meta.status, 200);
    assert.equal(meta.body.mime, "image/png", "a PNG stays a PNG");
    assert.ok(meta.body.sizeBytes > 0, "re-encoding produced bytes");
    assert.equal(meta.body.url, null, "still no key exposed");
  });
});

// ─── 4. 🔴 The file rule ──────────────────────────────────────────────────────────

describe("🔴 file rule — oversize rejected, video rejected, link registered", () => {
  it("a >10MB upload → 4xx (rejected, link it instead)", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x41); // just over 10 MB
    const res = await uploadFile(big, "big.bin", "application/octet-stream", "knowledge", mominToken);
    assert.ok(res.status >= 400 && res.status < 500, `oversize must be rejected with 4xx (got ${res.status})`);
  });

  it("a video/mp4 upload → 400 (videos are link-only)", async () => {
    const res = await uploadFile(Buffer.from([0, 0, 0, 0]), "clip.mp4", "video/mp4", "knowledge", mominToken);
    assert.equal(res.status, 400, `a video upload must be rejected (got ${res.status}: ${JSON.stringify(res.body)})`);
  });

  it("POST /files/link {url, kind} → 201 isLink=true; the url is in metadata; /download is rejected (open via the url)", async () => {
    const url = "https://youtu.be/dQw4w9WgXcQ";
    const link = await api(BASE, "/files/link", {
      method: "POST",
      token: mominToken,
      body: { url, kind: "knowledge", filename: "a video" },
    });
    assert.equal(link.status, 201, `link register should succeed (got ${link.status}: ${JSON.stringify(link.body)})`);
    assert.equal(link.body.isLink, true, "a registered link is a link");
    assert.equal(link.body.url, url, "a link's url IS exposed in metadata (it's not secret)");
    const fileId = link.body.id as string;
    createdFileIds.push(fileId);

    // The binary download endpoint must NOT bounce to an external link (open-redirect);
    // clients open the link directly from its metadata url instead.
    const dl = await fetch(`${BASE}/files/${fileId}/download`, {
      headers: { authorization: `Bearer ${mominToken}` },
      redirect: "manual",
    });
    assert.equal(dl.status, 400, `a link is not downloadable through the stream endpoint (got ${dl.status})`);
    const meta = await api(BASE, `/files/${fileId}`, { token: mominToken });
    assert.equal(meta.body.url, url, "the link url is retrievable via metadata for the client to open");
  });
});

// ─── 5. Auth ──────────────────────────────────────────────────────────────────────

describe("auth — an unauthenticated upload is rejected", () => {
  it("POST /files with no token → 401", async () => {
    const res = await uploadFile(Buffer.from("nope"), "x.txt", "text/plain", "knowledge");
    assert.equal(res.status, 401, `an anonymous upload must be 401 (got ${res.status})`);
  });
});
