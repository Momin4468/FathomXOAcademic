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
 * Module 12 — custom fields, BLACK-BOX HTTP against the compiled app.
 * Proves the request-time guarantees (DESIGN_SPEC §2 #10, §8; CLAUDE.md §4):
 *   • DEFINING fields is governed (custom_fields:approve); VIEW/search is :view.
 *   • boundary value validation: type/options/applicability HARD (→400).
 *   • scope: a scoped field applies (describe) only on a matching record; an
 *     inapplicable value is rejected.
 *   • soft-at-draft / hard-at-gate required-ness on a work transition.
 *   • search by a stored custom value.
 *   • archive hides a def from list/describe but preserves stored values.
 *   • party + project smoke (set via create/update, shown on GET).
 * Needs FEATURE_CUSTOM_FIELDS + FEATURE_WORK + FEATURE_REFERENCE.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3226; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // custom_fields:view, NO approve

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin: custom_fields:approve + work:approve + reference
let writerToken = ""; // Writer: custom_fields:view + work:create, NO approve

let clientPartyA = ""; // a source party (job scope match)
let clientPartyB = ""; // a different source party (scope mismatch)
let writerPartyId = "";

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];
const createdDefIds: string[] = [];
const createdProjectIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_CUSTOM_FIELDS: "true",
      FEATURE_WORK: "true",
      FEATURE_REFERENCE: "true",
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

async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `cfuser+${randomUUID()}@fathomxo.test`;
  const body: Record<string, unknown> = { email, password: DEV_PASSWORD };
  if (partyId) body.partyId = partyId;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, {
    method: "POST",
    token: sysToken,
    body: { roleId },
  });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId };
}

async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)",
    [id, ORG, name, `{${type}}`],
  );
  createdPartyIds.push(id);
  return id;
}

/** Define a custom field via the API (governed); track it for teardown. */
async function defineField(token: string, body: Record<string, unknown>) {
  const res = await api(BASE, "/custom-fields", { method: "POST", token, body });
  if (res.status === 201) createdDefIds.push(res.body.id);
  return res;
}

async function createWorkItem(extra: Record<string, unknown> = {}, token = mominToken) {
  const res = await api(BASE, "/work", {
    method: "POST",
    token,
    body: { title: `CFTEST Job ${randomUUID().slice(0, 8)}`, ...extra },
  });
  if (res.status === 201) createdWorkItemIds.push(res.body.id);
  return res;
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

  clientPartyA = await makeParty("CFTEST Client A", "client");
  clientPartyB = await makeParty("CFTEST Client B", "client");
  writerPartyId = await makeParty("CFTEST Writer", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerPartyId));
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of createdProjectIds) {
    await admin.query("delete from milestone where project_id=$1", [id]);
    await admin.query("delete from project where id=$1", [id]);
  }
  for (const id of createdDefIds) {
    await admin.query("delete from custom_field_def where id=$1", [id]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    await admin.query("delete from party where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── catalog governance ──────────────────────────────────────────────────────

describe("custom-fields catalog — governance (custom_fields:approve to define)", () => {
  it("admin defines a text field + a select field on work_item", async () => {
    const text = await defineField(mominToken, {
      targetEntity: "work_item",
      fieldName: "WhatsApp Reference",
      fieldType: "text",
    });
    assert.equal(text.status, 201, `text def should succeed (got ${text.status}: ${JSON.stringify(text.body)})`);
    assert.equal(text.body.fieldType, "text");

    const sel = await defineField(mominToken, {
      targetEntity: "work_item",
      fieldName: "Priority",
      fieldType: "select",
      options: ["low", "high"],
    });
    assert.equal(sel.status, 201, `select def should succeed (got ${sel.status}: ${JSON.stringify(sel.body)})`);
    assert.deepEqual(sel.body.optionsJson, ["low", "high"]);
  });

  it("a select def with no options → 400", async () => {
    const res = await defineField(mominToken, {
      targetEntity: "work_item",
      fieldName: "Bad Select",
      fieldType: "select",
    });
    assert.equal(res.status, 400, "a select needs at least one option");
  });

  it("a Writer (no custom_fields:approve) defining a field → 403", async () => {
    const res = await defineField(writerToken, {
      targetEntity: "work_item",
      fieldName: "Hacker Field",
      fieldType: "text",
    });
    assert.equal(res.status, 403, "defining fields requires custom_fields:approve");
  });

  it("a Writer CAN GET /custom-fields (view) and /custom-fields/search (view)", async () => {
    const list = await api(BASE, "/custom-fields?targetEntity=work_item", { token: writerToken });
    assert.equal(list.status, 200, "Writer holds custom_fields:view for the catalog");
    assert.ok(Array.isArray(list.body));

    // search needs a valid uuid fieldId; any catalog def id works.
    const anyDef = (list.body as Array<any>)[0];
    assert.ok(anyDef, "the catalog has at least one def to search by");
    const search = await api(
      BASE,
      `/custom-fields/search?targetEntity=work_item&fieldId=${anyDef.id}&q=zzz`,
      { token: writerToken },
    );
    assert.equal(search.status, 200, "Writer may search (custom_fields:view)");
  });
});

// ─── value validation at the boundary ────────────────────────────────────────

describe("value validation on POST /work (type/options/applicability HARD → 400)", () => {
  let numberDefId = "";
  let boolDefId = "";
  let selectDefId = "";
  let textDefId = "";

  before(async () => {
    const num = await defineField(mominToken, { targetEntity: "work_item", fieldName: "Pages", fieldType: "number" });
    numberDefId = num.body.id;
    const bool = await defineField(mominToken, { targetEntity: "work_item", fieldName: "Urgent", fieldType: "bool" });
    boolDefId = bool.body.id;
    const sel = await defineField(mominToken, {
      targetEntity: "work_item",
      fieldName: "Channel",
      fieldType: "select",
      options: ["wa", "email"],
    });
    selectDefId = sel.body.id;
    const txt = await defineField(mominToken, { targetEntity: "work_item", fieldName: "Note", fieldType: "text" });
    textDefId = txt.body.id;
  });

  it("wrong type for a number field → 400", async () => {
    const res = await createWorkItem({ customJson: { [numberDefId]: "not-a-number" } });
    assert.equal(res.status, 400, `expected 400 (got ${res.status}: ${JSON.stringify(res.body)})`);
  });

  it("wrong type for a bool field → 400", async () => {
    const res = await createWorkItem({ customJson: { [boolDefId]: "yes" } });
    assert.equal(res.status, 400);
  });

  it("select value not in options → 400", async () => {
    const res = await createWorkItem({ customJson: { [selectDefId]: "carrier-pigeon" } });
    assert.equal(res.status, 400);
  });

  it("a value under an unknown field id → 400", async () => {
    const res = await createWorkItem({ customJson: { [randomUUID()]: "x" } });
    assert.equal(res.status, 400, "unknown def id must be rejected");
  });

  it("valid values persist and show on GET /work/:id under the def id", async () => {
    const res = await createWorkItem({
      customJson: { [numberDefId]: 12, [boolDefId]: true, [selectDefId]: "wa", [textDefId]: "hello" },
    });
    assert.equal(res.status, 201, `valid create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    const detail = await api(BASE, `/work/${res.body.id}`, { token: mominToken });
    assert.equal(detail.status, 200);
    const byId = new Map((detail.body.customFields as Array<any>).map((f) => [f.id, f]));
    assert.equal(byId.get(numberDefId)?.value, 12, "number value persisted");
    assert.equal(byId.get(boolDefId)?.value, true, "bool value persisted");
    assert.equal(byId.get(selectDefId)?.value, "wa", "select value persisted");
    assert.equal(byId.get(textDefId)?.value, "hello", "text value persisted");
  });
});

// ─── scope ───────────────────────────────────────────────────────────────────

describe("scope — a client-scoped field applies only on a matching job", () => {
  let scopedDefId = "";

  before(async () => {
    const res = await defineField(mominToken, {
      targetEntity: "work_item",
      fieldName: "Client A Portal",
      fieldType: "text",
      scope: { clientPartyId: clientPartyA },
    });
    scopedDefId = res.body.id;
  });

  it("the scoped field is described on a job whose source = the scoped client", async () => {
    const job = await createWorkItem({ sourcePartyId: clientPartyA });
    const detail = await api(BASE, `/work/${job.body.id}`, { token: mominToken });
    const ids = (detail.body.customFields as Array<any>).map((f) => f.id);
    assert.ok(ids.includes(scopedDefId), "the field applies to the matching-client job");
  });

  it("the scoped field is NOT described on a job for a different client", async () => {
    const job = await createWorkItem({ sourcePartyId: clientPartyB });
    const detail = await api(BASE, `/work/${job.body.id}`, { token: mominToken });
    const ids = (detail.body.customFields as Array<any>).map((f) => f.id);
    assert.ok(!ids.includes(scopedDefId), "the field does not apply to a non-matching-client job");
  });

  it("a value for the scoped field on a non-matching job → 400 (inapplicable)", async () => {
    const res = await createWorkItem({
      sourcePartyId: clientPartyB,
      customJson: { [scopedDefId]: "x" },
    });
    assert.equal(res.status, 400, "an inapplicable field value must be rejected");
  });

  it("a value for the scoped field on the matching job is accepted", async () => {
    const res = await createWorkItem({
      sourcePartyId: clientPartyA,
      customJson: { [scopedDefId]: "portal-123" },
    });
    assert.equal(res.status, 201, `matching-scope value should be accepted (got ${res.status}: ${JSON.stringify(res.body)})`);
  });
});

// ─── soft-at-draft / hard-at-gate ─────────────────────────────────────────────

describe("required custom field — soft at draft, hard at the confirm gate", () => {
  let requiredDefId = "";

  before(async () => {
    const res = await defineField(mominToken, {
      targetEntity: "work_item",
      fieldName: "Deadline Source",
      fieldType: "text",
      required: true,
    });
    requiredDefId = res.body.id;
  });

  it("creating a draft job with the required field empty is OK (soft)", async () => {
    const res = await createWorkItem();
    assert.equal(res.status, 201, "a required field is soft at draft — create succeeds");
    const detail = await api(BASE, `/work/${res.body.id}`, { token: mominToken });
    const f = (detail.body.customFields as Array<any>).find((x) => x.id === requiredDefId);
    assert.ok(f, "the required field is described");
    assert.equal(f.missingRequired, true, "it is flagged as missing (soft signal)");
  });

  it("transition →confirmed with the required field empty → 400 (hard gate)", async () => {
    const job = await createWorkItem();
    const toPending = await api(BASE, `/work/${job.body.id}/transition`, {
      method: "POST",
      token: mominToken,
      body: { toState: "pending" },
    });
    assert.equal(toPending.status, 201, "draft→pending is a valid step");
    const confirm = await api(BASE, `/work/${job.body.id}/transition`, {
      method: "POST",
      token: mominToken,
      body: { toState: "confirmed" },
    });
    assert.equal(confirm.status, 400, "the gate blocks confirm while a required field is empty");
    assert.match(JSON.stringify(confirm.body), /required custom field/i, "the error names the rule");
  });

  it("filling the required field (PATCH) then →confirmed succeeds", async () => {
    const job = await createWorkItem();
    await api(BASE, `/work/${job.body.id}/transition`, { method: "POST", token: mominToken, body: { toState: "pending" } });
    const patch = await api(BASE, `/work/${job.body.id}`, {
      method: "PATCH",
      token: mominToken,
      body: { customJson: { [requiredDefId]: "client email" } },
    });
    assert.equal(patch.status, 200, `PATCH customJson should succeed (got ${patch.status}: ${JSON.stringify(patch.body)})`);
    const confirm = await api(BASE, `/work/${job.body.id}/transition`, {
      method: "POST",
      token: mominToken,
      body: { toState: "confirmed" },
    });
    assert.equal(confirm.status, 201, `confirm should now pass the gate (got ${confirm.status}: ${JSON.stringify(confirm.body)})`);
  });
});

// ─── search ───────────────────────────────────────────────────────────────────

describe("search — find a record by a stored custom value", () => {
  it("a job with a WhatsApp Reference is found by GET /custom-fields/search", async () => {
    const def = await defineField(mominToken, {
      targetEntity: "work_item",
      fieldName: "WA Ref Search",
      fieldType: "text",
    });
    const defId = def.body.id;
    const token = `wa-${randomUUID().slice(0, 8)}`;
    const job = await createWorkItem({ customJson: { [defId]: `ref ${token} tail` } });
    assert.equal(job.status, 201);

    const res = await api(
      BASE,
      `/custom-fields/search?targetEntity=work_item&fieldId=${defId}&q=${token}`,
      { token: mominToken },
    );
    assert.equal(res.status, 200);
    const ids = (res.body as Array<any>).map((r) => r.id);
    assert.ok(ids.includes(job.body.id), "the job is found by the partial custom value");
  });
});

// ─── archive ───────────────────────────────────────────────────────────────────

describe("archive — def disappears from list/describe but stored values survive", () => {
  it("archived def vanishes from list + describe; its value stays in custom_json", async () => {
    const def = await defineField(mominToken, {
      targetEntity: "work_item",
      fieldName: "Temp Field",
      fieldType: "text",
    });
    const defId = def.body.id;
    const job = await createWorkItem({ customJson: { [defId]: "keep-me" } });
    assert.equal(job.status, 201);

    // present before archive
    const before = await api(BASE, `/work/${job.body.id}`, { token: mominToken });
    assert.ok((before.body.customFields as Array<any>).some((f) => f.id === defId), "described before archive");

    const arch = await api(BASE, `/custom-fields/${defId}/archive`, { method: "POST", token: mominToken });
    assert.equal(arch.status, 201, `archive should succeed (got ${arch.status})`);

    // gone from the catalog list
    const list = await api(BASE, "/custom-fields?targetEntity=work_item", { token: mominToken });
    assert.ok(!(list.body as Array<any>).some((d) => d.id === defId), "archived def absent from list");

    // gone from describe
    const after = await api(BASE, `/work/${job.body.id}`, { token: mominToken });
    assert.ok(!(after.body.customFields as Array<any>).some((f) => f.id === defId), "archived def absent from describe");

    // but the stored value is NOT destroyed
    const raw = await admin.query("select custom_json ->> $1 as v from work_item where id=$2", [defId, job.body.id]);
    assert.equal(raw.rows[0].v, "keep-me", "the stored value survives archival (not destroyed)");
  });
});

// ─── party + project smoke ───────────────────────────────────────────────────

describe("party + project — define, set via create/update, show on GET", () => {
  it("a party field set on create shows on GET /parties/:id", async () => {
    const def = await defineField(mominToken, { targetEntity: "party", fieldName: "Telegram", fieldType: "text" });
    const defId = def.body.id;
    const created = await api(BASE, "/parties", {
      method: "POST",
      token: mominToken,
      body: { displayName: `CFTEST Party ${randomUUID().slice(0, 6)}`, partyType: ["client"], customJson: { [defId]: "@handle" } },
    });
    assert.equal(created.status, 201, `party create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
    const partyId = created.body.id;
    createdPartyIds.push(partyId);
    const detail = await api(BASE, `/parties/${partyId}`, { token: mominToken });
    assert.equal(detail.status, 200);
    const f = (detail.body.customFields as Array<any>).find((x) => x.id === defId);
    assert.ok(f, "the party custom field is described");
    assert.equal(f.value, "@handle", "the party custom value is shown");
  });

  it("a project field set on create shows on GET /projects/:id", async () => {
    const def = await defineField(mominToken, { targetEntity: "project", fieldName: "Cohort", fieldType: "text" });
    const defId = def.body.id;
    const created = await api(BASE, "/projects", {
      method: "POST",
      token: mominToken,
      body: { title: `CFTEST Project ${randomUUID().slice(0, 6)}`, customJson: { [defId]: "2026-spring" } },
    });
    assert.equal(created.status, 201, `project create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
    const projectId = created.body.id;
    createdProjectIds.push(projectId);
    const detail = await api(BASE, `/projects/${projectId}`, { token: mominToken });
    assert.equal(detail.status, 200);
    const f = (detail.body.customFields as Array<any>).find((x) => x.id === defId);
    assert.ok(f, "the project custom field is described");
    assert.equal(f.value, "2026-spring", "the project custom value is shown");
  });
});
