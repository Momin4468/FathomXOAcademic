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
 * RBAC admin layer (roles/permissions management) — BLACK-BOX HTTP against the
 * COMPILED app (dist/main.js). Proves the guarantees that must never silently
 * break:
 *   • SuperAdmin-only: an org Admin (no `platform`) is 403 on the roles surface
 *   • the permission catalog reflects REAL @RequirePermission usage (truthful grid)
 *   • a role WITHOUT a permission → the holder is denied that action (the point)
 *   • is_system protections: no rename/delete of built-ins; System SuperAdmin fully
 *     immutable; but a built-in role's PERMISSIONS are editable
 *   • no self-escalation: a non-SuperAdmin can't grant a role they hold a perm they
 *     lack
 *   • tenant isolation: an org can't see or touch another org's roles
 * Requires FEATURE_WORK + FEATURE_BILLING so those modules mount (for the catalog +
 * the denial check).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3251;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const SYS_ROLE = "00000000-0000-4000-8000-0000000000a1"; // System SuperAdmin (immutable)
const ADMIN_ROLE = "00000000-0000-4000-8000-0000000000a3"; // is_system, has perms
const MANAGER_ROLE = "00000000-0000-4000-8000-0000000000a4"; // is_system, empty perms

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = ""; // System SuperAdmin (bypass)
let mominToken = ""; // Admin (no platform)

const createdRoleIds: string[] = [];
const createdUserIds: string[] = [];
let orgB = "";
let roleB = "";

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_WORK: "true", FEATURE_BILLING: "true" },
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

/** Create a login (as sysadmin), assign one role, log it in. */
async function makeUserWithRole(roleId: string): Promise<{ token: string; userId: string }> {
  const email = `rbac+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD } });
  assert.equal(created.status, 201, `user create (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  assert.equal(assigned.status, 201, `role assign (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId };
}

async function createRole(name: string): Promise<string> {
  const res = await api(BASE, "/platform/roles", { method: "POST", token: sysToken, body: { name, description: "test role" } });
  assert.equal(res.status, 201, `role create (got ${res.status}: ${JSON.stringify(res.body)})`);
  const id = res.body.id as string;
  createdRoleIds.push(id);
  return id;
}

async function grant(token: string, roleId: string, module: string, action: string, granted = true) {
  return api(BASE, `/platform/roles/${roleId}/permissions`, { method: "PUT", token, body: { module, action, granted } });
}

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200);
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;
});

after(async () => {
  // Roles created via API + their permissions.
  for (const id of createdRoleIds) {
    await admin.query("delete from permission where role_id=$1", [id]);
    await admin.query("delete from user_role where role_id=$1", [id]);
    await admin.query("delete from role where id=$1", [id]);
  }
  // Test users (refresh tokens + role links reference the account — clear first).
  for (const id of createdUserIds) {
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  // Any perms granted to seeded roles during the is_system-editable check.
  await admin.query("delete from permission where role_id=$1 and module=$2 and action=$3", [MANAGER_ROLE, "checks", "view"]);
  // The cross-org fixture.
  if (roleB) await admin.query("delete from role where id=$1", [roleB]);
  if (orgB) await admin.query("delete from org where id=$1", [orgB]);
  await admin.end();
  server?.kill();
});

describe("RBAC admin — access + catalog", () => {
  it("is SuperAdmin-only: an org Admin (no platform) is 403 on the roles surface", async () => {
    const ok = await api(BASE, "/platform/roles", { token: sysToken });
    assert.equal(ok.status, 200, "System SuperAdmin can list roles");
    assert.ok(Array.isArray(ok.body) && ok.body.length >= 8, "seeded roles are listed");

    const denied = await api(BASE, "/platform/roles", { token: mominToken });
    assert.equal(denied.status, 403, "Admin (lacks platform) is forbidden");
  });

  it("the permission catalog reflects REAL @RequirePermission usage", async () => {
    const res = await api(BASE, "/platform/permission-catalog", { token: sysToken });
    assert.equal(res.status, 200);
    assert.ok(res.body.actions.includes("delete") && res.body.actions.includes("export"), "6-action column set");

    const work = res.body.modules.find((mod: { key: string }) => mod.key === "work");
    assert.ok(work, "work module present");
    assert.equal(work.enforced.approve, true, "work:approve is enforced");
    assert.equal(work.enforced.view, true, "work:view is enforced");

    const billing = res.body.modules.find((mod: { key: string }) => mod.key === "billing");
    assert.ok(billing, "billing module present");
    assert.equal(billing.enforced.view, true, "billing:view is enforced");
    assert.equal(billing.enforced.delete, false, "billing:delete is NOT enforced (no endpoint uses it)");

    // personal_finance has its own plane — never gated via @RequirePermission.
    assert.ok(!res.body.modules.some((mod: { key: string }) => mod.key === "personal_finance"), "PF excluded");
  });
});

describe("RBAC admin — a role without a permission denies its holder", () => {
  it("work:view only → GET /work 200 but POST /work 403", async () => {
    const roleId = await createRole("RBAC Viewer");
    const g = await grant(sysToken, roleId, "work", "view");
    assert.equal(g.status, 200, `grant work:view (got ${g.status}: ${JSON.stringify(g.body)})`);

    const { token } = await makeUserWithRole(roleId);
    const read = await api(BASE, "/work", { token });
    assert.equal(read.status, 200, "holder can view work");
    const write = await api(BASE, "/work", { method: "POST", token, body: {} });
    assert.equal(write.status, 403, "holder lacking work:create is denied (guard before validation)");
  });
});

describe("RBAC admin — is_system protections", () => {
  it("built-in roles can't be renamed or deleted, but their permissions ARE editable", async () => {
    const rename = await api(BASE, `/platform/roles/${ADMIN_ROLE}`, { method: "PATCH", token: sysToken, body: { name: "Renamed" } });
    assert.equal(rename.status, 400, "renaming a built-in role is rejected");

    const desc = await api(BASE, `/platform/roles/${ADMIN_ROLE}`, { method: "PATCH", token: sysToken, body: { description: "an editable note" } });
    assert.equal(desc.status, 200, "editing a built-in role's description is allowed");

    const del = await api(BASE, `/platform/roles/${ADMIN_ROLE}`, { method: "DELETE", token: sysToken });
    assert.equal(del.status, 400, "deleting a built-in role is rejected");

    // Permissions of an ordinary system role are editable (Manager ships empty).
    const on = await grant(sysToken, MANAGER_ROLE, "checks", "view", true);
    assert.equal(on.status, 200, "granting a permission on a built-in role is allowed");
    const off = await grant(sysToken, MANAGER_ROLE, "checks", "view", false);
    assert.equal(off.status, 200, "revoking it again is allowed");
  });

  it("the System SuperAdmin role is fully immutable", async () => {
    const patch = await api(BASE, `/platform/roles/${SYS_ROLE}`, { method: "PATCH", token: sysToken, body: { description: "nope" } });
    assert.equal(patch.status, 403, "System SuperAdmin can't be edited");
    const perm = await grant(sysToken, SYS_ROLE, "work", "approve", true);
    assert.equal(perm.status, 403, "System SuperAdmin permissions can't be changed");
    const del = await api(BASE, `/platform/roles/${SYS_ROLE}`, { method: "DELETE", token: sysToken });
    assert.equal(del.status, 403, "System SuperAdmin can't be deleted");
  });

  it("a grant for a not-yet-enforced action is rejected (strict grid)", async () => {
    const roleId = await createRole("RBAC Strict");
    const res = await grant(sysToken, roleId, "billing", "delete", true);
    assert.equal(res.status, 400, "billing:delete isn't enforced by any endpoint, so it can't be granted");
  });
});

describe("RBAC admin — no self-escalation", () => {
  it("a non-SuperAdmin can't grant a role they hold a permission they lack", async () => {
    // A delegate role that CAN manage roles (platform view/create/approve) but has
    // no work perms.
    const delegateRole = await createRole("RBAC Delegate");
    for (const action of ["view", "create", "approve"]) {
      const g = await grant(sysToken, delegateRole, "platform", action);
      assert.equal(g.status, 200, `grant platform:${action}`);
    }
    const { token: delegateToken } = await makeUserWithRole(delegateRole);

    // Grant to a role the delegate HOLDS a permission the delegate LACKS → blocked.
    const self = await grant(delegateToken, delegateRole, "work", "approve", true);
    assert.equal(self.status, 403, "can't self-escalate on a role you hold");

    // But granting to a role the delegate does NOT hold is allowed (holdsRole=false).
    const other = await createRole("RBAC Other");
    const okOther = await grant(delegateToken, other, "work", "view", true);
    assert.equal(okOther.status, 200, "granting to a role you don't hold is allowed");
  });
});

describe("RBAC admin — tenant isolation", () => {
  it("an org can't see or touch another org's roles", async () => {
    orgB = randomUUID();
    roleB = randomUUID();
    await admin.query("insert into org (id, name) values ($1,$2)", [orgB, "RBAC OrgB"]);
    await admin.query("insert into role (id, org_id, name, is_system) values ($1,$2,$3,false)", [roleB, orgB, "OrgB Secret"]);

    const list = await api(BASE, "/platform/roles", { token: sysToken });
    assert.equal(list.status, 200);
    assert.ok(!list.body.some((r: { id: string }) => r.id === roleB), "org B's role is invisible to org A");

    const get = await api(BASE, `/platform/roles/${roleB}`, { token: sysToken });
    assert.equal(get.status, 404, "org A can't read org B's role (RLS → not found)");

    const patch = await api(BASE, `/platform/roles/${roleB}`, { method: "PATCH", token: sysToken, body: { description: "x" } });
    assert.equal(patch.status, 404, "org A can't mutate org B's role");
  });
});
