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
 * Module 1 (reference data + party/client directory) — BLACK-BOX HTTP tests.
 * Boots the COMPILED app (dist/main.js) and drives it with fetch (see helpers).
 * Proves the request-time guarantees: fuzzy-in/canonical-out resolution,
 * provisional->confirmed governance (approve-gated), capture-first party create
 * with university auto-resolve, the directory search/detail/patch surface, and the
 * permission boundaries (Writer = no reference perms; Data Steward = approve but no
 * create). Requires FEATURE_REFERENCE=true so the routes mount.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3211; // dedicated test port (auth-http uses 3210; dev default 3001)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // no reference perms
const STEWARD_ROLE = "00000000-0000-4000-8000-0000000000aa"; // reference:view+approve, NO create
const SEED_COURSE = "00000000-0000-4000-8000-0000000000e2"; // canonical "ICT 701"

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

// Tokens populated in before().
let mominToken = ""; // Admin = reference view/create/edit/approve
let sysToken = ""; // System SuperAdmin (creates users + assigns roles)
let writerToken = ""; // a user holding ONLY the Writer role (no reference perms)
let stewardToken = ""; // a user holding ONLY the Data Steward role (approve, no create)

// Track created ids for teardown.
const createdUserIds: string[] = [];
const createdEntityIds: string[] = [];
const createdPartyIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_REFERENCE: "true" },
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

/** Create a login (sysadmin) + assign exactly one role, then log it in. */
async function makeUserWithRole(roleId: string): Promise<{ token: string; userId: string }> {
  const email = `m1user+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", {
    method: "POST",
    token: sysToken,
    body: { email, password: DEV_PASSWORD },
  });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status})`);
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

before(async () => {
  await admin.connect();
  await startServer();

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE));
  ({ token: stewardToken } = await makeUserWithRole(STEWARD_ROLE));
});

after(async () => {
  // Parties FIRST (they FK-reference ref_entity via university_id + each other via
  // referred_by), then aliases, then the entities.
  for (const id of createdPartyIds) {
    await admin.query("update party set referred_by_party_id=null where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    await admin.query("delete from party where id=$1", [id]);
  }
  await admin.query("delete from party where display_name like 'M1TEST %'");
  for (const id of createdEntityIds) {
    await admin.query("delete from ref_alias where ref_id=$1", [id]);
    await admin.query("delete from ref_entity where id=$1", [id]);
  }
  // Provisional entities created via party.universityRaw auto-resolve aren't tracked
  // individually; sweep test-created ones by canonical marker.
  await admin.query("delete from ref_alias where alias like 'M1TEST %'");
  await admin.query("delete from ref_entity where canonical like 'M1TEST %'");
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── Fuzzy / canonical resolution ──────────────────────────────────────────────

describe("fuzzy-in / canonical-out resolution (DESIGN_SPEC §7)", () => {
  for (const q of ["ICT701", "701", "ict 701", "ICT  701"]) {
    it(`search "${q}" returns the seeded canonical course`, async () => {
      const res = await api(BASE, `/reference?kind=course&q=${encodeURIComponent(q)}`, { token: mominToken });
      assert.equal(res.status, 200, `expected 200 (got ${res.status})`);
      const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
      assert.ok(ids.includes(SEED_COURSE), `"${q}" must resolve to the seeded course; got ${JSON.stringify(ids)}`);
    });
  }

  it(`a typo "ict70" still ranks the canonical course (trigram tolerance)`, async () => {
    const res = await api(BASE, `/reference?kind=course&q=ict70`, { token: mominToken });
    assert.equal(res.status, 200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    assert.ok(ids.includes(SEED_COURSE), `a near-miss typo should still surface the canonical; got ${JSON.stringify(ids)}`);
  });

  it("POST /reference/resolve of an existing spelling returns created=false + the canonical", async () => {
    const res = await api(BASE, "/reference/resolve", {
      method: "POST",
      token: mominToken,
      body: { kind: "course", raw: "ICT-701" }, // normalizes to ict701 -> existing alias
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.created, false, "an existing spelling must NOT create a new entity");
    assert.equal(res.body.entity.id, SEED_COURSE, "must return the seeded canonical");
  });

  it("POST /reference/resolve of a brand-new code returns created=true + status=provisional", async () => {
    const raw = `M1TEST Course ${randomUUID().slice(0, 8)}`;
    const res = await api(BASE, "/reference/resolve", {
      method: "POST",
      token: mominToken,
      body: { kind: "course", raw },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.created, true, "a new code must create a provisional entity (capture-first)");
    assert.equal(res.body.entity.status, "provisional");
    assert.equal(res.body.entity.canonical, raw);
    createdEntityIds.push(res.body.entity.id);
  });
});

// ─── Governance: provisional -> confirmed, approve-gated ────────────────────────

describe("governance: provisional -> confirmed (approve-gated, DESIGN_SPEC §7)", () => {
  it("a caller WITHOUT reference:approve (Writer) cannot confirm -> 403", async () => {
    // Create a provisional via momin first.
    const raw = `M1TEST Confirm ${randomUUID().slice(0, 8)}`;
    const made = await api(BASE, "/reference/resolve", {
      method: "POST",
      token: mominToken,
      body: { kind: "course", raw },
    });
    const id = made.body.entity.id as string;
    createdEntityIds.push(id);

    const denied = await api(BASE, `/reference/${id}/confirm`, { method: "POST", token: writerToken });
    assert.equal(denied.status, 403, "Writer has no reference perms — confirm must be denied");

    const still = await api(BASE, `/reference/${id}`, { token: mominToken });
    assert.equal(still.body.status, "provisional", "an unconfirmed claim is not a fact");
  });

  it("momin (has reference:approve) confirms -> status=confirmed", async () => {
    const raw = `M1TEST Confirm2 ${randomUUID().slice(0, 8)}`;
    const made = await api(BASE, "/reference/resolve", {
      method: "POST",
      token: mominToken,
      body: { kind: "course", raw },
    });
    const id = made.body.entity.id as string;
    createdEntityIds.push(id);

    const ok = await api(BASE, `/reference/${id}/confirm`, { method: "POST", token: mominToken });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.status, "confirmed");

    const audit = await admin.query(
      "select count(*)::int n from audit_log where action='reference.entity_confirmed' and entity_id=$1",
      [id],
    );
    assert.equal(audit.rows[0].n, 1, "confirm must be audited");
  });

  it("the Data Steward role CAN confirm (approve) but CANNOT create a reference entity (no create) -> 403", async () => {
    // Steward confirms a momin-made provisional (proves approve works for non-owner).
    const raw = `M1TEST StewardConfirm ${randomUUID().slice(0, 8)}`;
    const made = await api(BASE, "/reference/resolve", {
      method: "POST",
      token: mominToken,
      body: { kind: "course", raw },
    });
    const id = made.body.entity.id as string;
    createdEntityIds.push(id);

    const confirm = await api(BASE, `/reference/${id}/confirm`, { method: "POST", token: stewardToken });
    assert.equal(confirm.status, 201, "Data Steward holds reference:approve");
    assert.equal(confirm.body.status, "confirmed");

    // But the steward lacks reference:create -> resolve (which creates) is denied.
    const create = await api(BASE, "/reference/resolve", {
      method: "POST",
      token: stewardToken,
      body: { kind: "course", raw: `M1TEST StewardCreate ${randomUUID().slice(0, 8)}` },
    });
    assert.equal(create.status, 403, "Data Steward must NOT be able to create reference entities");
  });
});

// ─── Permission boundary on the directory ───────────────────────────────────────

describe("permission boundary: Writer has no reference perms (DESIGN_SPEC §4/§7)", () => {
  it("Writer cannot search reference -> 403", async () => {
    const res = await api(BASE, "/reference?kind=course&q=ict", { token: writerToken });
    assert.equal(res.status, 403);
  });

  it("Writer cannot list parties -> 403 (client contact not exposed to Writers)", async () => {
    const res = await api(BASE, "/parties", { token: writerToken });
    assert.equal(res.status, 403);
  });

  it("Data Steward (no reference:create) cannot create a party -> 403", async () => {
    const res = await api(BASE, "/parties", {
      method: "POST",
      token: stewardToken,
      body: { displayName: "M1TEST Should Fail", partyType: ["client"] },
    });
    assert.equal(res.status, 403, "party create needs reference:create, which the steward lacks");
  });
});

// ─── Directory: create / search / detail / patch ────────────────────────────────

describe("party directory: capture-first create + search + detail + patch (DESIGN_SPEC §7)", () => {
  let partyId = "";
  const studentId = `S-${randomUUID().slice(0, 8)}`;
  const uniRaw = `M1TEST University ${randomUUID().slice(0, 8)}`;

  it("POST /parties with universityRaw auto-resolves to a provisional university and links it", async () => {
    const res = await api(BASE, "/parties", {
      method: "POST",
      token: mominToken,
      body: {
        displayName: "M1TEST Jane Student",
        partyType: ["client"],
        externalRef: studentId,
        universityRaw: uniRaw,
        programme: "MBA",
      },
    });
    assert.equal(res.status, 201, `party create should succeed (got ${res.status})`);
    partyId = res.body.id as string;
    createdPartyIds.push(partyId);
    assert.ok(res.body.universityId, "a university must have been auto-resolved/linked");
    assert.equal(res.body.universityCanonical, uniRaw, "the linked university canonical should echo the typed name");

    // The auto-created reference entity is provisional (capture-first governance).
    const u = await admin.query("select status from ref_entity where id=$1", [res.body.universityId]);
    assert.equal(u.rows[0].status, "provisional", "an auto-resolved new university is provisional until confirmed");
  });

  it("GET /parties?q= finds by display name", async () => {
    const res = await api(BASE, `/parties?q=${encodeURIComponent("Jane Student")}`, { token: mominToken });
    assert.equal(res.status, 200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    assert.ok(ids.includes(partyId), "search by display name must find the party");
  });

  it("GET /parties?q= finds by external_ref (student id)", async () => {
    const res = await api(BASE, `/parties?q=${encodeURIComponent(studentId)}`, { token: mominToken });
    assert.equal(res.status, 200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    assert.ok(ids.includes(partyId), "search by external_ref (student id) must find the party");
  });

  it("PATCH updates fields and sets referred_by; GET :id returns universityCanonical + referredByName", async () => {
    // A referrer party to point at.
    const refRes = await api(BASE, "/parties", {
      method: "POST",
      token: mominToken,
      body: { displayName: "M1TEST Referrer Bob", partyType: ["referrer"] },
    });
    const referrerId = refRes.body.id as string;
    createdPartyIds.push(referrerId);

    const patch = await api(BASE, `/parties/${partyId}`, {
      method: "PATCH",
      token: mominToken,
      body: { programme: "MBA Thesis", referredByPartyId: referrerId },
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.programme, "MBA Thesis", "patched field must persist");
    assert.equal(patch.body.referredByPartyId, referrerId);

    const detail = await api(BASE, `/parties/${partyId}`, { token: mominToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.universityCanonical, uniRaw, "detail resolves the university canonical");
    assert.equal(detail.body.referredByName, "M1TEST Referrer Bob", "detail resolves the referred-by name");
  });
});

// ─── Validation at the boundary (CLAUDE.md §4) ──────────────────────────────────

describe("boundary validation (treat client input as hostile, CLAUDE.md §4)", () => {
  it("resolve with an invalid kind -> 400", async () => {
    const res = await api(BASE, "/reference/resolve", {
      method: "POST",
      token: mominToken,
      body: { kind: "not_a_kind", raw: "x" },
    });
    assert.equal(res.status, 400, "an out-of-enum kind must be rejected by the DTO");
  });

  it("resolve with an empty raw -> 400", async () => {
    const res = await api(BASE, "/reference/resolve", {
      method: "POST",
      token: mominToken,
      body: { kind: "course", raw: "" },
    });
    assert.equal(res.status, 400, "empty raw must be rejected (MinLength)");
  });

  it("party create with a missing displayName -> 400", async () => {
    const res = await api(BASE, "/parties", {
      method: "POST",
      token: mominToken,
      body: { partyType: ["client"] },
    });
    assert.equal(res.status, 400, "displayName is required");
  });

  it("party create with an out-of-enum partyType -> 400", async () => {
    const res = await api(BASE, "/parties", {
      method: "POST",
      token: mominToken,
      body: { displayName: "M1TEST Bad Type", partyType: ["overlord"] },
    });
    assert.equal(res.status, 400, "party_type values must be from the canonical enum");
  });

  it("GET /reference/:id with a non-uuid -> 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/reference/not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });
});
