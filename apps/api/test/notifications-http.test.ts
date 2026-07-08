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
 * P1 item 7 — in-app notifications + admin broadcast. BLACK-BOX HTTP. Proves:
 *   • a broadcast fans out one notification per resolved recipient;
 *   • a recipient sees only their OWN rows (a non-recipient sees zero); unread-count
 *     is correct; mark-one/all-read flips read_at; a user can't mark another's read;
 *   • broadcast is notifications:approve-gated (a view-only user → 403);
 *   • a role broadcast reaches role members and not a non-member.
 * Requires FEATURE_NOTIFICATIONS.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3263;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // Writer — has notifications:view, NOT approve
const COORD_ROLE = "00000000-0000-4000-8000-0000000000a5"; // Coordinator — a non-member of the Writer broadcast

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let adminToken = ""; // momin — Admin (notifications:approve)
let sysToken = "";
const createdUserIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_NOTIFICATIONS: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE, 90000);
}

const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });

async function makeUser(roleId: string): Promise<{ id: string; token: string }> {
  const email = `notif+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  createdUserIds.push(id);
  const assigned = await api(BASE, `/platform/users/${id}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  const token = (await login(email, DEV_PASSWORD)).body.accessToken as string;
  return { id, token };
}

const list = (token: string) => api(BASE, "/notifications", { token });
const unread = (token: string) => api(BASE, "/notifications/unread-count", { token });

let userA: { id: string; token: string };
let userB: { id: string; token: string };
let userC: { id: string; token: string }; // Coordinator — non-member / non-recipient

before(async () => {
  await admin.connect();
  await startServer();
  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  adminToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  userA = await makeUser(WRITER_ROLE);
  userB = await makeUser(WRITER_ROLE);
  userC = await makeUser(COORD_ROLE);
});

after(async () => {
  for (const id of createdUserIds) {
    await admin.query("delete from notification where recipient_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  await admin.query("delete from notification where created_by is not null and title like 'TEST %'");
  await admin.query("delete from notification_broadcast where title like 'TEST %'");
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("in-app notifications + admin broadcast (P1 item 7)", () => {
  it("a users-broadcast fans out one notification per recipient; non-recipients see zero", async () => {
    const title = `TEST users ${randomUUID().slice(0, 6)}`;
    const bc = await api(BASE, "/notifications/broadcast", {
      method: "POST",
      token: adminToken,
      body: { audienceKind: "users", userIds: [userA.id, userB.id], title, body: "Hello two." },
    });
    assert.equal(bc.status, 201, JSON.stringify(bc.body));
    assert.equal(bc.body.recipients, 2);

    const a = await list(userA.token);
    assert.equal(a.status, 200);
    assert.equal((a.body as Array<any>).filter((n) => n.title === title).length, 1, "userA got exactly one");
    assert.equal((await list(userB.token)).body.filter((n: any) => n.title === title).length, 1, "userB got one");
    assert.equal((await list(userC.token)).body.filter((n: any) => n.title === title).length, 0, "userC (not targeted) got none");
    assert.equal((await unread(userA.token)).body.unread >= 1, true);
  });

  it("a recipient can't mark another user's notification read; mark-one/all-read flips read_at", async () => {
    const title = `TEST rw ${randomUUID().slice(0, 6)}`;
    await api(BASE, "/notifications/broadcast", { method: "POST", token: adminToken, body: { audienceKind: "users", userIds: [userA.id], title } });
    const row = (await list(userA.token)).body.find((n: any) => n.title === title);
    assert.ok(row, "userA has the notification");
    assert.equal(row.readAt, null, "starts unread");

    // userB tries to mark userA's notification read → no-op (self-scoped guard).
    const cross = await api(BASE, `/notifications/${row.id}/read`, { method: "POST", token: userB.token });
    assert.equal(cross.status, 200); // endpoint succeeds but updates nothing it doesn't own
    const stillUnread = (await list(userA.token)).body.find((n: any) => n.id === row.id);
    assert.equal(stillUnread.readAt, null, "another user's mark-read did NOT touch userA's row");

    // userA marks it read → flips.
    const own = await api(BASE, `/notifications/${row.id}/read`, { method: "POST", token: userA.token });
    assert.equal(own.status, 200);
    const nowRead = (await list(userA.token)).body.find((n: any) => n.id === row.id);
    assert.notEqual(nowRead.readAt, null, "userA's own mark-read flipped read_at");

    // read-all clears the rest.
    await api(BASE, "/notifications/read-all", { method: "POST", token: userA.token });
    assert.equal((await unread(userA.token)).body.unread, 0, "read-all zeroes the unread count");
  });

  it("broadcast is notifications:approve-gated (a view-only Writer → 403)", async () => {
    const res = await api(BASE, "/notifications/broadcast", {
      method: "POST",
      token: userA.token, // Writer: notifications:view only
      body: { audienceKind: "users", userIds: [userB.id], title: "TEST nope" },
    });
    assert.equal(res.status, 403);
  });

  it("a role broadcast reaches role members and not a non-member", async () => {
    const title = `TEST role ${randomUUID().slice(0, 6)}`;
    const bc = await api(BASE, "/notifications/broadcast", {
      method: "POST",
      token: adminToken,
      body: { audienceKind: "role", roleId: WRITER_ROLE, title },
    });
    assert.equal(bc.status, 201, JSON.stringify(bc.body));
    assert.ok(bc.body.recipients >= 2, "at least our two Writers");
    assert.equal((await list(userA.token)).body.filter((n: any) => n.title === title).length, 1, "Writer userA got it");
    assert.equal((await list(userC.token)).body.filter((n: any) => n.title === title).length, 0, "Coordinator userC did NOT");
  });
});
