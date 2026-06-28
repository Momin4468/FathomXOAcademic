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
 * Work list `sourcePartyId` filter — BLACK-BOX HTTP against the COMPILED app
 * (dist/main.js). Proves GET /work?sourcePartyId=X returns ONLY jobs whose
 * work_item.source_party_id = X (capture-first, money-free projection), and that
 * an unknown/other client yields zero rows (not an error, not a leak of others).
 * Requires FEATURE_WORK=true.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3231; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let mominToken = ""; // Admin (work:view+create)

let clientA = "";
let clientB = "";
const createdWorkItemIds: string[] = [];
const createdPartyIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_WORK: "true" },
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

async function makeParty(name: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,'{client}')",
    [id, ORG, name],
  );
  createdPartyIds.push(id);
  return id;
}

async function createJob(sourcePartyId?: string): Promise<string> {
  const body: Record<string, unknown> = { title: `WSF Job ${randomUUID().slice(0, 8)}` };
  if (sourcePartyId) body.sourcePartyId = sourcePartyId;
  const res = await api(BASE, "/work", { method: "POST", token: mominToken, body });
  assert.equal(res.status, 201, `work create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdWorkItemIds.push(res.body.id);
  return res.body.id as string;
}

before(async () => {
  await admin.connect();
  await startServer();
  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  clientA = await makeParty("WSF Client A");
  clientB = await makeParty("WSF Client B");
});

after(async () => {
  for (const id of createdWorkItemIds) await admin.query("delete from work_item where id=$1", [id]);
  for (const id of createdPartyIds) await admin.query("delete from party where id=$1", [id]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("work list sourcePartyId filter (GET /work?sourcePartyId=)", () => {
  let aJob1 = "";
  let aJob2 = "";
  let bJob1 = "";
  let noClientJob = "";

  it("seed: 2 jobs for client A, 1 for client B, 1 with no client", async () => {
    aJob1 = await createJob(clientA);
    aJob2 = await createJob(clientA);
    bJob1 = await createJob(clientB);
    noClientJob = await createJob();
    assert.ok(aJob1 && aJob2 && bJob1 && noClientJob);
  });

  it("?sourcePartyId=A returns exactly A's two jobs (and every row has source=A)", async () => {
    const res = await api(BASE, `/work?sourcePartyId=${clientA}`, { token: mominToken });
    assert.equal(res.status, 200);
    const rows = res.body as Array<{ id: string; sourcePartyId: string }>;
    const ids = new Set(rows.map((r) => r.id));
    assert.ok(ids.has(aJob1) && ids.has(aJob2), "both A jobs present");
    assert.ok(!ids.has(bJob1), "B's job is excluded by the filter");
    assert.ok(!ids.has(noClientJob), "a job with no source party is excluded");
    for (const r of rows) assert.equal(r.sourcePartyId, clientA, "every returned row is scoped to A");
  });

  it("?sourcePartyId=B returns only B's job, never A's", async () => {
    const res = await api(BASE, `/work?sourcePartyId=${clientB}`, { token: mominToken });
    assert.equal(res.status, 200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    assert.ok(ids.includes(bJob1), "B's job present");
    assert.ok(!ids.includes(aJob1) && !ids.includes(aJob2), "A's jobs absent under the B filter");
  });

  it("an unknown client id yields zero rows (not an error, not other clients' jobs)", async () => {
    const res = await api(BASE, `/work?sourcePartyId=${randomUUID()}`, { token: mominToken });
    assert.equal(res.status, 200, "an unmatched filter returns 200 with an empty set");
    assert.deepEqual(res.body, [], "zero rows for an unknown client");
  });

  it("a malformed (non-uuid) sourcePartyId → 400 (boundary validation)", async () => {
    const res = await api(BASE, "/work?sourcePartyId=not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });

  it("the filtered list carries no money fields (capture-first projection)", async () => {
    const res = await api(BASE, `/work?sourcePartyId=${clientA}`, { token: mominToken });
    const blob = JSON.stringify(res.body);
    assert.ok(!/clientRate|writerRate|"amount"/.test(blob), "the list projection must be money-free");
  });
});
