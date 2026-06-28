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
 * Knowledge base + cover sheets — BLACK-BOX HTTP against dist/main.js
 * (DESIGN_SPEC §7/§8, CLAUDE.md §8 governance, §4 validation). Proves:
 *   • 🔴 OPEN AUTHORING: any role (incl. a pure Writer) can POST an article
 *   • attachments surface a file's metadata on GET
 *   • cover sheets need knowledge:approve to write but are readable by all
 *   • the university hub surfaces programmes, referencing styles, articles, sheets
 *   • edit guard: a non-author non-curator writer cannot PATCH another's article;
 *     the author can; an admin (approve) can
 *   • boundary validation (bad enum, non-uuid)
 * Requires FEATURE_KNOWLEDGE=true; STORAGE_DIR a fresh temp dir.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3222; // distinct from files-http (3221)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const STORAGE_DIR = mkdtempSync(join(tmpdir(), "bos-kb-"));

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // knowledge:view+create only

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin (knowledge:approve)
let writerToken = ""; // pure Writer (view+create)
let writer2Token = ""; // a second pure Writer (for the edit guard)

const createdUserIds: string[] = [];
const createdArticleIds: string[] = [];
const createdCoverSheetIds: string[] = [];
const createdFileIds: string[] = [];
const createdRefIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_KNOWLEDGE: "true", FEATURE_REFERENCE: "true", STORAGE_DIR },
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

async function makeWriterUser(): Promise<string> {
  const email = `kbwriter+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD } });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, { method: "POST", token: sysToken, body: { roleId: WRITER_ROLE } });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new writer should log in");
  return li.body.accessToken as string;
}

/** Insert a ref_entity directly (admin); kind any valid REF_KIND. */
async function makeRef(kind: string, canonical: string, parentId?: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into ref_entity (id, org_id, kind, canonical, parent_id, status) values ($1,$2,$3,$4,$5,'confirmed')",
    [id, ORG, kind, canonical, parentId ?? null],
  );
  createdRefIds.push(id);
  return id;
}

/** Upload a tiny file as momin → returns the file_object id. */
async function uploadText(text: string, token: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(text)], { type: "text/plain" }), "att.txt");
  fd.append("kind", "knowledge");
  const res = await fetch(`${BASE}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  assert.equal(res.status, 201, "attachment upload should succeed");
  const body = (await res.json()) as { id: string };
  createdFileIds.push(body.id);
  return body.id;
}

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  writerToken = await makeWriterUser();
  writer2Token = await makeWriterUser();
});

after(async () => {
  for (const id of createdArticleIds) {
    await admin.query("delete from knowledge_attachment where article_id=$1", [id]);
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from knowledge_article where id=$1", [id]);
  }
  for (const id of createdCoverSheetIds) {
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from cover_sheet_template where id=$1", [id]);
  }
  for (const id of createdFileIds) {
    await admin.query("delete from knowledge_attachment where file_object_id=$1", [id]);
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from file_object where id=$1", [id]);
  }
  // Reverse order so child ref_entities (course/style) are removed before their parent university.
  for (const id of [...createdRefIds].reverse()) {
    await admin.query("delete from ref_entity where id=$1", [id]);
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

// ─── 1. 🔴 Open authoring ──────────────────────────────────────────────────────────

describe("🔴 open authoring — any role (incl. a pure Writer) can author", () => {
  it("Writer POST /knowledge/articles → 201", async () => {
    const res = await api(BASE, "/knowledge/articles", {
      method: "POST",
      token: writerToken,
      body: { type: "doc", title: "Writer's how-to" },
    });
    assert.equal(res.status, 201, `a Writer must be able to author (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.ok(res.body.id);
    createdArticleIds.push(res.body.id);
  });
});

// ─── 2. Attachments surface file metadata ──────────────────────────────────────────

describe("attachments — a created article surfaces its file metadata", () => {
  it("upload a file, create an article with attachmentFileIds, GET → attachments include it", async () => {
    const fileId = await uploadText("attachment body", mominToken);
    const create = await api(BASE, "/knowledge/articles", {
      method: "POST",
      token: mominToken,
      body: { type: "prompt_pack", title: "Pack with media", attachmentFileIds: [fileId] },
    });
    assert.equal(create.status, 201, `article create should succeed (got ${create.status}: ${JSON.stringify(create.body)})`);
    createdArticleIds.push(create.body.id);

    const get = await api(BASE, `/knowledge/articles/${create.body.id}`, { token: mominToken });
    assert.equal(get.status, 200);
    assert.ok(Array.isArray(get.body.attachments), "attachments is an array");
    const att = get.body.attachments.find((a: any) => a.id === fileId);
    assert.ok(att, "the attached file appears in attachments");
    assert.equal(att.filename, "att.txt", "attachment metadata is surfaced");
  });
});

// ─── 3. Cover sheets — approve to write, view for all ───────────────────────────────

describe("cover sheets — write needs approve, read is open", () => {
  it("Writer POST /knowledge/cover-sheets → 403 (needs knowledge:approve)", async () => {
    const res = await api(BASE, "/knowledge/cover-sheets", {
      method: "POST",
      token: writerToken,
      body: { name: "Writer cover sheet" },
    });
    assert.equal(res.status, 403, `a Writer must not create cover sheets (got ${res.status})`);
  });

  it("momin (admin) POST /knowledge/cover-sheets → 201", async () => {
    const res = await api(BASE, "/knowledge/cover-sheets", {
      method: "POST",
      token: mominToken,
      body: { name: "Admin cover sheet" },
    });
    assert.equal(res.status, 201, `an admin must be able to create cover sheets (got ${res.status}: ${JSON.stringify(res.body)})`);
    createdCoverSheetIds.push(res.body.id);
  });

  it("Writer GET /knowledge/cover-sheets → 200 (readable by all)", async () => {
    const res = await api(BASE, "/knowledge/cover-sheets", { token: writerToken });
    assert.equal(res.status, 200, "cover sheets are readable by any role with view");
    assert.ok(Array.isArray(res.body));
  });
});

// ─── 4. University hub ──────────────────────────────────────────────────────────────

describe("university hub — surfaces programmes, styles, articles, cover sheets", () => {
  it("GET /knowledge/university/:id returns the linked children + content", async () => {
    const uniId = await makeRef("university", `KBTEST Uni ${randomUUID().slice(0, 8)}`);
    const courseId = await makeRef("course", `KBTEST Course ${randomUUID().slice(0, 8)}`, uniId);
    const styleId = await makeRef("referencing_style", `KBTEST Style ${randomUUID().slice(0, 8)}`, uniId);

    const art = await api(BASE, "/knowledge/articles", {
      method: "POST",
      token: mominToken,
      body: { type: "doc", title: "Uni-linked doc", universityRefId: uniId },
    });
    assert.equal(art.status, 201, `linked article create should succeed (got ${art.status}: ${JSON.stringify(art.body)})`);
    createdArticleIds.push(art.body.id);

    const cs = await api(BASE, "/knowledge/cover-sheets", {
      method: "POST",
      token: mominToken,
      body: { name: "Uni cover sheet", universityRefId: uniId },
    });
    assert.equal(cs.status, 201, `linked cover sheet create should succeed (got ${cs.status})`);
    createdCoverSheetIds.push(cs.body.id);

    const hub = await api(BASE, `/knowledge/university/${uniId}`, { token: writerToken });
    assert.equal(hub.status, 200, `hub should be readable (got ${hub.status}: ${JSON.stringify(hub.body)})`);
    assert.equal(hub.body.university.id, uniId);
    assert.ok(hub.body.programmes.some((p: any) => p.id === courseId), "the course is a programme");
    assert.ok(hub.body.referencingStyles.some((r: any) => r.id === styleId), "the style is a referencing style");
    assert.ok(hub.body.articles.some((a: any) => a.id === art.body.id), "the linked article shows");
    assert.ok(hub.body.coverSheets.some((c: any) => c.id === cs.body.id), "the linked cover sheet shows");
  });
});

// ─── 5. Edit guard ───────────────────────────────────────────────────────────────

describe("edit guard — author-own or curator only", () => {
  let articleId = "";

  before(async () => {
    const res = await api(BASE, "/knowledge/articles", {
      method: "POST",
      token: writerToken,
      body: { type: "doc", title: "Owned by writer 1" },
    });
    assert.equal(res.status, 201);
    articleId = res.body.id;
    createdArticleIds.push(articleId);
  });

  it("🔴 a SECOND writer cannot PATCH the first writer's article → 403", async () => {
    const res = await api(BASE, `/knowledge/articles/${articleId}`, {
      method: "PATCH",
      token: writer2Token,
      body: { title: "Hijacked" },
    });
    assert.equal(res.status, 403, `only the author or a curator may edit (got ${res.status}: ${JSON.stringify(res.body)})`);
  });

  it("the author CAN PATCH their own article → 200", async () => {
    const res = await api(BASE, `/knowledge/articles/${articleId}`, {
      method: "PATCH",
      token: writerToken,
      body: { title: "Edited by author" },
    });
    assert.equal(res.status, 200, `the author must be able to edit (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.title, "Edited by author");
  });

  it("an admin (curator, knowledge:approve) CAN PATCH another's article → 200", async () => {
    const res = await api(BASE, `/knowledge/articles/${articleId}`, {
      method: "PATCH",
      token: mominToken,
      body: { title: "Curated by admin" },
    });
    assert.equal(res.status, 200, `a curator must be able to edit any article (got ${res.status})`);
  });
});

// ─── 6. Boundary validation ─────────────────────────────────────────────────────────

describe("boundary validation (treat client input as hostile, CLAUDE.md §4)", () => {
  it("POST /knowledge/articles with a bad type enum → 400", async () => {
    const res = await api(BASE, "/knowledge/articles", {
      method: "POST",
      token: mominToken,
      body: { type: "memo", title: "Bad type" },
    });
    assert.equal(res.status, 400, "an out-of-enum type must be rejected");
  });

  it("GET /knowledge/articles/:id with a non-uuid → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/knowledge/articles/not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });
});
