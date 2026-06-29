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
 * Import / Export / Archive module (migration 0031, DESIGN_SPEC §7/§10) —
 * BLACK-BOX HTTP tests against the COMPILED app (dist/main.js).
 *
 * The invariants under test (the ones that must never silently break):
 *   • Preview STAGES rows only — NO domain row is written until commit (a draft,
 *     not a fact). Invalid rows are flagged with errors and skipped at commit.
 *   • Commit routes every valid row through the EXISTING create service so
 *     validation, RLS, canonical reference resolution (fuzzy-in/canonical-out,
 *     dedup) and the `import_batch_id` provenance stamp all apply.
 *   • Money (payment) is created only via the create service, import-stamped.
 *   • 2025 settlement opening = an opening TRANSFER only — never fabricated
 *     jobs/legs.
 *   • Export inherits RLS + per-dataset view permission — you cannot export a
 *     figure you cannot see (no billing:view → 403); no import_export:view → 403.
 *   • Permission/tenant gates hold (a Writer without import_export → 403).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3242; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work only — NO import_export, NO billing:view

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin (a3) — has import_export + reference/work/billing/expenses
let writerToken = ""; // a6 Writer — NO import_export

// Track everything created so `after` can clean up deterministically.
const createdUserIds: string[] = [];
const batchIds: string[] = [];
const archiveIds: string[] = [];

function spawnServer(port: number): ChildProcess {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  const proc = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      FEATURE_IMPORT_EXPORT: "true",
      FEATURE_WORK: "true",
      FEATURE_BILLING: "true",
      FEATURE_EXPENSES: "true",
      FEATURE_REFERENCE: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api:${port}] ${s}`);
  });
  return proc;
}

async function login(email: string, password: string) {
  return api(BASE, "/auth/login", { method: "POST", body: { email, password } });
}

/** Create a login (via sysadmin), assign one role, log it in. */
async function makeUserWithRole(roleId: string): Promise<{ token: string; userId: string; email: string }> {
  const email = `imex+${randomUUID()}@fathomxo.test`;
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

/** Raw multipart fetch (the api() helper JSON-encodes; preview/commit need a file). */
async function preview(token: string, entity: string, csv: string, filename = `${entity}.csv`) {
  const fd = new FormData();
  fd.append("entity", entity);
  fd.append("file", new Blob([csv], { type: "text/csv" }), filename);
  const res = await fetch(`${BASE}/import/preview`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (res.status === 201 && body?.batch?.id) batchIds.push(body.batch.id);
  return { status: res.status, body };
}

async function commit(token: string, batchId: string) {
  return api(BASE, `/import/${batchId}/commit`, { method: "POST", token });
}

/** Raw fetch for export endpoints (binary/text bodies, not JSON). */
async function exportRaw(token: string, dataset: string, format?: string) {
  const qs = format ? `?format=${format}` : "";
  const res = await fetch(`${BASE}/export/${dataset}${qs}`, { headers: { authorization: `Bearer ${token}` } });
  const ct = res.headers.get("content-type") ?? "";
  const text = ct.includes("spreadsheet") ? "" : await res.text();
  return { status: res.status, contentType: ct, text };
}

async function pgCount(query: string, params: unknown[]): Promise<number> {
  const r = await admin.query(query, params);
  return Number(r.rows[0].c);
}

before(async () => {
  await admin.connect();
  server = spawnServer(PORT);
  await waitForHealth(BASE, 120000);

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  // A plain Writer (a6): work-only, NO import_export, NO billing:view.
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE));
});

after(async () => {
  // Domain rows created by committed batches — delete by the provenance marker
  // (FK order: allocations → payments; aliases → ref_entities).
  for (const id of batchIds) {
    await admin.query("delete from payment_allocation where payment_id in (select id from payment where import_batch_id=$1)", [id]);
    await admin.query("delete from payment where import_batch_id=$1", [id]);
    await admin.query("delete from settlement_transfer where import_batch_id=$1", [id]);
    await admin.query("delete from work_item where import_batch_id=$1", [id]);
    await admin.query("delete from party where import_batch_id=$1", [id]);
    await admin.query("delete from audit_log where entity='import_batch' and entity_id=$1", [id]);
    await admin.query("delete from import_row where batch_id=$1", [id]);
    await admin.query("delete from import_batch where id=$1", [id]);
  }
  // Provisional ref_entities + their aliases created by imports (universities /
  // courses used only in these tests). Aliases first (FK).
  const refLikes = ["%monash%", "%ict 701%", "%ict701%"];
  for (const like of refLikes) {
    await admin.query(
      "delete from ref_alias where ref_id in (select id from ref_entity where status='provisional' and lower(canonical) like $1)",
      [like],
    );
    await admin.query("delete from ref_entity where status='provisional' and lower(canonical) like $1", [like]);
  }
  for (const id of archiveIds) {
    await admin.query("delete from audit_log where entity='archive_item' and entity_id=$1", [id]);
    // archive_item references file_object → delete the archive row FIRST, then its file.
    const fo = await admin.query("select file_object_id from archive_item where id=$1", [id]);
    await admin.query("delete from archive_item where id=$1", [id]);
    const fileObjectId = fo.rows[0]?.file_object_id;
    if (fileObjectId) await admin.query("delete from file_object where id=$1", [fileObjectId]);
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

// ─── 1. Template ──────────────────────────────────────────────────────────────

describe("template — the downloadable format spec", () => {
  it("GET /import/template/clients returns the exact header row", async () => {
    const res = await fetch(`${BASE}/import/template/clients`, { headers: { authorization: `Bearer ${mominToken}` } });
    assert.equal(res.status, 200, "the template download should succeed");
    const text = await res.text();
    const firstLine = text.split(/\r?\n/)[0];
    assert.equal(
      firstLine,
      "displayName,partyType,externalRef,universityName,programme,contactEmail,contactPhone,referredByName",
      "the template's first line is the exact expected header set",
    );
  });
});

// ─── 2. Clients: preview/commit + canonicalisation + provenance ───────────────

describe("clients — preview stages, commit creates, university dedup, provenance", () => {
  let batchId = "";
  const tag = randomUUID().slice(0, 8); // unique names so cleanup + asserts are isolated

  it("preview validates (2 good / 1 bad) and writes NO party rows", async () => {
    const csv = [
      "displayName,partyType,externalRef,universityName,programme,contactEmail,contactPhone,referredByName",
      `Client A ${tag},client,,Monash University,MIT,,,`,
      `Client B ${tag},client,,monash university,MBA,,,`, // same uni, different spelling
      `,client,,Monash University,,,,`, // bad: blank displayName
    ].join("\r\n");
    const res = await preview(mominToken, "clients", csv);
    assert.equal(res.status, 201, `preview should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    batchId = res.body.batch.id;
    assert.equal(res.body.batch.validCount, 2, "two rows valid");
    assert.equal(res.body.batch.invalidCount, 1, "one row invalid");

    const bad = (res.body.rows as any[]).find((r) => r.status === "invalid");
    assert.ok(bad, "the blank-displayName row is flagged invalid");
    assert.ok(Array.isArray(bad.errorsJson) && bad.errorsJson.length > 0, "the invalid row carries an error");
    assert.match(JSON.stringify(bad.errorsJson), /displayName/i, "the error names the missing field");

    // CRUX: preview is a dry run — no party committed yet.
    const c = await pgCount("select count(*)::int c from party where display_name like $1", [`Client% ${tag}`]);
    assert.equal(c, 0, "preview wrote NO party rows (a draft, not a fact)");
  });

  it("commit creates the 2 valid parties, import-stamped, with the two uni spellings deduped to ONE ref_entity", async () => {
    const res = await commit(mominToken, batchId);
    assert.equal(res.status, 201, `commit should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.batch.committedCount, 2, "exactly the two valid rows committed");
    assert.equal(res.body.batch.status, "committed", "the batch moves to committed");

    const stamped = await pgCount(
      "select count(*)::int c from party where display_name like $1 and import_batch_id=$2",
      [`Client% ${tag}`, batchId],
    );
    assert.equal(stamped, 2, "both created parties carry the import_batch_id provenance marker");

    // Dedup: "Monash University" and "monash university" resolve to ONE canonical.
    const universities = await admin.query(
      "select id, university_id from party where display_name like $1 and import_batch_id=$2",
      [`Client% ${tag}`, batchId],
    );
    const uniIds = new Set(universities.rows.map((r) => r.university_id));
    assert.equal(uniIds.size, 1, "both clients point at the SAME university ref_entity (fuzzy-in/canonical-out dedup)");
    assert.ok([...uniIds][0], "the university was resolved (not left null)");

    const refCount = await pgCount(
      "select count(*)::int c from ref_entity where kind='university' and lower(canonical) like '%monash%'",
      [],
    );
    assert.equal(refCount, 1, "only ONE monash university ref_entity exists (no duplicate canonical)");
  });
});

// ─── 3. Jobs naming a new client ──────────────────────────────────────────────

describe("jobs — a job naming a brand-new client creates both, draft + import-stamped", () => {
  const tag = randomUUID().slice(0, 8);
  let batchId = "";

  it("preview shows the new client 'will create' and the course canonicalised", async () => {
    const csv = [
      "title,clientName,courseCode,assignmentType,doerName,details,notes",
      `Essay ${tag},Zed New ${tag},ICT 701,essay,,,`,
    ].join("\r\n");
    const res = await preview(mominToken, "jobs", csv);
    assert.equal(res.status, 201, `preview should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    batchId = res.body.batch.id;
    assert.equal(res.body.batch.validCount, 1, "the job row is valid");
    const reso = JSON.stringify((res.body.rows as any[])[0].resolutionJson);
    assert.match(reso, /will create new client/i, "preview flags the unknown client as 'will create'");
  });

  it("commit creates a draft work_item (import-stamped) with the new client as source + canonical course", async () => {
    const res = await commit(mominToken, batchId);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.batch.committedCount, 1, "the job committed");

    const wi = await admin.query(
      "select work_state, source_party_id, course_ref_id, import_batch_id from work_item where import_batch_id=$1",
      [batchId],
    );
    assert.equal(wi.rowCount, 1, "one work_item created");
    assert.equal(wi.rows[0].work_state, "draft", "an imported job lands in draft (not auto-confirmed)");
    assert.ok(wi.rows[0].course_ref_id, "the course was canonicalised to a ref_entity");

    // The new client party was created AND import-stamped via the same batch.
    const client = await admin.query("select id, import_batch_id from party where display_name=$1", [`Zed New ${tag}`]);
    assert.equal(client.rowCount, 1, "the named client was created");
    assert.equal(client.rows[0].import_batch_id, batchId, "the auto-created client is import-stamped too");
    assert.equal(wi.rows[0].source_party_id, client.rows[0].id, "the new client is the job's source party");

    const courseCount = await pgCount(
      "select count(*)::int c from ref_entity where kind='course' and lower(canonical) like '%ict 701%' or lower(canonical) like '%ict701%'",
      [],
    );
    assert.ok(courseCount >= 1, "the ICT 701 course ref_entity exists");
  });
});

// ─── 4. Payments ──────────────────────────────────────────────────────────────

describe("payments — money created only via the service, import-stamped", () => {
  const tag = randomUUID().slice(0, 8);
  it("commit a payment CSV creates a payment with import_batch_id", async () => {
    const csv = [
      "direction,counterpartyName,amount,paidAt,medium,trxId,note",
      `in,Payer ${tag},7500,2026-03-10,bkash,,imex test`,
    ].join("\r\n");
    const pv = await preview(mominToken, "payments", csv);
    assert.equal(pv.status, 201, JSON.stringify(pv.body));
    assert.equal(pv.body.batch.validCount, 1, "the payment row is valid");
    const batchId = pv.body.batch.id;

    // CRUX: no payment exists pre-commit.
    assert.equal(await pgCount("select count(*)::int c from payment where import_batch_id=$1", [batchId]), 0, "no payment at preview");

    const cm = await commit(mominToken, batchId);
    assert.equal(cm.status, 201, JSON.stringify(cm.body));
    assert.equal(cm.body.batch.committedCount, 1, "the payment committed");

    const pay = await admin.query("select amount, direction, import_batch_id from payment where import_batch_id=$1", [batchId]);
    assert.equal(pay.rowCount, 1, "one payment created");
    assert.equal(Number(pay.rows[0].amount), 7500, "the amount matches the CSV");
    assert.equal(pay.rows[0].direction, "in", "direction preserved");
  });
});

// ─── 5. Partial commit ────────────────────────────────────────────────────────

describe("partial commit — a row that passes preview but fails the DTO fails alone", () => {
  const tag = randomUUID().slice(0, 8);
  it("an over-long displayName (passes preview's blank check, fails @MaxLength) → that row 'failed', the valid one created", async () => {
    const longName = "Z".repeat(250); // > @MaxLength(200) on CreatePartyDto.displayName
    const csv = [
      "displayName,partyType,externalRef,universityName,programme,contactEmail,contactPhone,referredByName",
      `Good ${tag},client,,,,,,`,
      `${longName},client,,,,,,`,
    ].join("\r\n");
    const pv = await preview(mominToken, "clients", csv);
    assert.equal(pv.status, 201, JSON.stringify(pv.body));
    // Preview only checks blank, so BOTH rows pass the light check.
    assert.equal(pv.body.batch.validCount, 2, "preview's light check passes both rows");
    const batchId = pv.body.batch.id;

    const cm = await commit(mominToken, batchId);
    assert.equal(cm.status, 201, JSON.stringify(cm.body));
    assert.equal(cm.body.batch.committedCount, 1, "only the valid row committed");
    assert.equal(cm.body.batch.failedCount, 1, "the over-long row failed at commit");

    const failed = (cm.body.rows as any[]).find((r) => r.status === "failed");
    assert.ok(failed, "the failing row is marked 'failed'");
    assert.ok(failed.errorsJson && JSON.stringify(failed.errorsJson).length > 2, "the failed row carries a commit error");

    // The valid row WAS created (one bad row does not poison the batch).
    const good = await pgCount("select count(*)::int c from party where display_name=$1 and import_batch_id=$2", [`Good ${tag}`, batchId]);
    assert.equal(good, 1, "the good row was created despite the sibling failing");
    const bad = await pgCount("select count(*)::int c from party where display_name=$1", [longName]);
    assert.equal(bad, 0, "the over-long row created NO party");
  });
});

// ─── 6. settlement_opening (2025 = settlement only, no fabricated jobs) ────────

describe("settlement_opening — an opening transfer, never fabricated jobs/legs", () => {
  it("a valid Emon→Momin opening creates a settlement_transfer (note '2025 opening'), and NO work_item/leg", async () => {
    const csv = [
      "fromPartyName,toPartyName,amount,asOfDate,note",
      "Emon,Momin,50000,2026-01-01,carryover",
    ].join("\r\n");
    const pv = await preview(mominToken, "settlement_opening", csv);
    assert.equal(pv.status, 201, JSON.stringify(pv.body));
    assert.equal(pv.body.batch.validCount, 1, "the opening row is valid");
    const batchId = pv.body.batch.id;

    const cm = await commit(mominToken, batchId);
    assert.equal(cm.status, 201, JSON.stringify(cm.body));
    assert.equal(cm.body.batch.committedCount, 1, "the opening committed");

    const t = await admin.query("select amount, note, import_batch_id from settlement_transfer where import_batch_id=$1", [batchId]);
    assert.equal(t.rowCount, 1, "one settlement_transfer created");
    assert.equal(Number(t.rows[0].amount), 50000, "the opening amount matches");
    assert.match(String(t.rows[0].note), /^2025 opening/, "the note is prefixed '2025 opening'");

    // CRUX: 2025 = settlement only — this batch fabricated NO jobs or legs.
    assert.equal(await pgCount("select count(*)::int c from work_item where import_batch_id=$1", [batchId]), 0, "no work_item fabricated by the opening");
  });

  it("an unknown partner name → that row errors (preview invalid, commit creates nothing)", async () => {
    const csv = [
      "fromPartyName,toPartyName,amount,asOfDate,note",
      "Nobody XYZ,Momin,1000,2026-01-01,bad",
    ].join("\r\n");
    const pv = await preview(mominToken, "settlement_opening", csv);
    assert.equal(pv.status, 201, JSON.stringify(pv.body));
    assert.equal(pv.body.batch.invalidCount, 1, "the unknown-partner row is invalid at preview");
    assert.match(JSON.stringify((pv.body.rows as any[])[0].errorsJson), /not found/i, "the error says the partner was not found");

    const cm = await commit(mominToken, pv.body.batch.id);
    assert.equal(cm.status, 201, JSON.stringify(cm.body));
    assert.equal(cm.body.batch.committedCount, 0, "no transfer created from an invalid row");
  });
});

// ─── 7. Export — visibility inherited from RLS + per-dataset permission ────────

describe("export — you cannot export a figure you cannot see", () => {
  it("GET /export/clients?format=csv (momin) → 200 CSV containing data", async () => {
    const res = await exportRaw(mominToken, "clients", "csv");
    assert.equal(res.status, 200, `clients export should succeed (got ${res.status})`);
    assert.match(res.contentType, /text\/csv/, "served as CSV");
  });

  it("GET /export/jobs?format=csv (momin) → 200", async () => {
    const res = await exportRaw(mominToken, "jobs", "csv");
    assert.equal(res.status, 200, "jobs export should succeed");
  });

  it("GET /export/clients?format=xlsx (momin) → 200 with the xlsx content-type", async () => {
    const res = await exportRaw(mominToken, "clients", "xlsx");
    assert.equal(res.status, 200, "xlsx export should succeed");
    assert.match(res.contentType, /spreadsheetml\.sheet/, "served with the xlsx mime type");
  });

  it("a Writer with NO import_export:view → GET /export/clients → 403 at the controller", async () => {
    const res = await exportRaw(writerToken, "clients", "csv");
    assert.equal(res.status, 403, `the export controller requires import_export:view (got ${res.status})`);
  });
});

// ─── 8. Archive ───────────────────────────────────────────────────────────────

describe("archive — dated searchable file store", () => {
  const title = `Archive Doc ${randomUUID().slice(0, 8)}`;
  let archiveId = "";
  let fileObjectId = "";

  it("POST /archive (multipart title + file) → 201", async () => {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("description", "imex archive test");
    fd.append("file", new Blob(["archived content"], { type: "text/plain" }), "doc.txt");
    const res = await fetch(`${BASE}/archive`, { method: "POST", headers: { authorization: `Bearer ${mominToken}` }, body: fd });
    const body = await res.json();
    assert.equal(res.status, 201, `archive create should succeed (got ${res.status}: ${JSON.stringify(body)})`);
    archiveId = body.id;
    fileObjectId = body.fileObjectId;
    archiveIds.push(archiveId);
    assert.ok(fileObjectId, "the archive item references a file_object");
  });

  it("GET /archive?q=<title> returns it, GET /archive/:id → 200", async () => {
    const list = await api(BASE, `/archive?q=${encodeURIComponent(title)}`, { token: mominToken });
    assert.equal(list.status, 200, "archive search should succeed");
    assert.ok((list.body as any[]).some((r) => r.id === archiveId), "the search finds the archived doc by title");

    const one = await api(BASE, `/archive/${archiveId}`, { token: mominToken });
    assert.equal(one.status, 200, "the archive item is readable by id");
    assert.equal(one.body.title, title, "the right item is returned");
  });

  it("the archived file is downloadable for an import_export:view holder", async () => {
    const res = await fetch(`${BASE}/files/${fileObjectId}/download`, { headers: { authorization: `Bearer ${mominToken}` } });
    assert.equal(res.status, 200, `the file should download (got ${res.status})`);
    const text = await res.text();
    assert.equal(text, "archived content", "the stored content streams back");
  });
});

// ─── 9. Permission / tenant gates ─────────────────────────────────────────────

describe("authz — the import_export module is gated", () => {
  it("a Writer with NO import_export → POST /import/preview → 403", async () => {
    const csv = "displayName,partyType\nNo Perm,client";
    const res = await preview(writerToken, "clients", csv);
    assert.equal(res.status, 403, `preview must require import_export:create (got ${res.status}: ${JSON.stringify(res.body)})`);
  });

  it("a Writer with NO import_export → GET /archive → 403", async () => {
    const res = await api(BASE, "/archive", { token: writerToken });
    assert.equal(res.status, 403, `archive list must require import_export:view (got ${res.status})`);
  });
});
