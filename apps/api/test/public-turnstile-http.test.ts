import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { waitForHealth } from "./helpers.js";

/**
 * PUBLIC quote intake — Cloudflare Turnstile gate (server-side, API-authoritative).
 * BLACK-BOX HTTP against the COMPILED app (dist/main.js). Proves:
 *   • when a secret IS configured, a MISSING token is rejected (400) BEFORE any
 *     lead/draft is created (no network needed — the empty-token guard fires first)
 *   • an INVALID token is rejected (400) with a GENERIC message — Cloudflare's
 *     internal error-codes are never leaked to the client — and nothing is created
 *   • a VALID token proceeds normally (200) and the lead/draft trail appears
 *
 * Uses Cloudflare's DOCUMENTED testing secrets (real siteverify network call):
 *   1x0000000000000000000000000000000AA → always PASSES
 *   2x0000000000000000000000000000000AA → always FAILS
 * Two servers are spawned (one per secret) since the secret is process-wide.
 * Requires FEATURE_CLIENT_PORTAL + FEATURE_WORK + FEATURE_BILLING (module mount).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PASS_SECRET = "1x0000000000000000000000000000000AA"; // Cloudflare: always passes
const FAIL_SECRET = "2x0000000000000000000000000000000AA"; // Cloudflare: always fails
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"; // any non-empty response; test secret ignores value

const PASS_PORT = 3254;
const FAIL_PORT = 3255;
const PASS_BASE = `http://localhost:${PASS_PORT}`;
const FAIL_BASE = `http://localhost:${FAIL_PORT}`;

const ORG = "00000000-0000-4000-8000-000000000001";

const RUN = randomUUID().slice(0, 8);
const emailFor = (tag: string) => `qa-turnstile+${tag}-${RUN}@example.com`;

// Distinct forwarded IPs so none of these cheap cases trip the per-IP rate limit.
const IP_MISSING = "7.7.1.1";
const IP_INVALID = "7.7.2.2";
const IP_VALID = "7.7.3.3";

let passServer: ChildProcess;
let failServer: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
const usedEmails: string[] = [];

function startServer(port: number, secret: string): { server: ChildProcess; ready: Promise<void> } {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  const server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      FEATURE_CLIENT_PORTAL: "true",
      FEATURE_WORK: "true",
      FEATURE_BILLING: "true",
      TURNSTILE_SECRET_KEY: secret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api:${port}] ${s}`);
  });
  return { server, ready: waitForHealth(`http://localhost:${port}`, 60000) };
}

interface QuoteResult {
  status: number;
  body: any;
}

/** POST a multipart quote. `fields` are text parts (incl. turnstileToken when present). */
async function postQuote(base: string, fields: Record<string, string>, ip: string): Promise<QuoteResult> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${base}/public/quote`, {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: form,
  });
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** A complete, valid set of text fields; caller adds/omits `turnstileToken`. */
function validFields(email: string, extra: Record<string, string> = {}): Record<string, string> {
  usedEmails.push(email);
  return {
    name: "QA Prospect",
    email,
    phone: "+8801700000000",
    country: "Bangladesh",
    service: "Essay",
    level: "Undergraduate",
    details: "Please help me with a 2000-word essay on macroeconomics.",
    ...extra,
  };
}

/** Was ANYTHING persisted for this email (account / party / work_item)? */
async function nothingCreated(email: string): Promise<boolean> {
  const acct = (await admin.query("select id from client_account where login_id=$1", [email])).rows;
  const party = (await admin.query("select id from party where org_id=$1 and contact_json->>'email'=$2", [ORG, email])).rows;
  return acct.length === 0 && party.length === 0;
}

before(async () => {
  await admin.connect();
  const a = startServer(PASS_PORT, PASS_SECRET);
  const b = startServer(FAIL_PORT, FAIL_SECRET);
  passServer = a.server;
  failServer = b.server;
  await Promise.all([a.ready, b.ready]);
});

after(async () => {
  for (const email of Array.from(new Set(usedEmails))) {
    const parties = new Set<string>();
    for (const r of (await admin.query("select party_id from client_account where login_id=$1", [email])).rows) {
      parties.add((r as { party_id: string }).party_id);
    }
    for (const r of (await admin.query("select id from party where org_id=$1 and contact_json->>'email'=$2", [ORG, email])).rows) {
      parties.add((r as { id: string }).id);
    }
    for (const pid of parties) {
      const items = (await admin.query("select id, brief_file_id from work_item where source_party_id=$1", [pid]))
        .rows as Array<{ id: string; brief_file_id: string | null }>;
      for (const it of items) {
        await admin.query("delete from audit_log where entity='work_item' and entity_id=$1", [it.id]);
        await admin.query("delete from leg where work_item_id=$1", [it.id]);
        await admin.query("delete from work_item where id=$1", [it.id]);
        if (it.brief_file_id) await admin.query("delete from file_object where id=$1", [it.brief_file_id]);
      }
      await admin.query("delete from client_account where party_id=$1", [pid]);
      await admin.query("delete from party where id=$1", [pid]);
    }
  }
  await admin.end();
  if (passServer && !passServer.killed) passServer.kill();
  if (failServer && !failServer.killed) failServer.kill();
});

// ─── 1. Missing token → 400 before any lead/draft (secret configured) ─────────

describe("a MISSING Turnstile token is rejected (400) before any lead/draft is created", () => {
  const email = emailFor("missing");

  it("POST with NO turnstileToken → 400", async () => {
    const res = await postQuote(PASS_BASE, validFields(email), IP_MISSING);
    assert.equal(res.status, 400, `missing token should 400 (got ${res.status}: ${JSON.stringify(res.body)})`);
  });

  it("DB: NOTHING was created — the gate runs before the write", async () => {
    assert.ok(await nothingCreated(email), "no party/account/work_item for a submission with no token");
  });
});

// ─── 2. Invalid token → generic 400, no leak, nothing created ─────────────────

describe("an INVALID Turnstile token is rejected (400) with a generic message, nothing created", () => {
  const email = emailFor("invalid");

  it("POST a token the always-fail secret rejects → 400", async () => {
    const res = await postQuote(FAIL_BASE, validFields(email, { turnstileToken: DUMMY_TOKEN }), IP_INVALID);
    assert.equal(res.status, 400, `invalid token should 400 (got ${res.status}: ${JSON.stringify(res.body)})`);
    // The message must NOT leak Cloudflare's internal error codes.
    const msg = (Array.isArray(res.body?.message) ? res.body.message.join(" ") : String(res.body?.message ?? "")).toLowerCase();
    assert.ok(!/error-codes|invalid-input|timeout-or-duplicate|missing-input|cloudflare|turnstile/.test(msg), `generic message only, got: ${msg}`);
  });

  it("DB: NOTHING was created for a rejected token", async () => {
    assert.ok(await nothingCreated(email), "no party/account/work_item for an invalid token");
  });
});

// ─── 3. Valid token → proceeds normally (200) and the lead trail appears ──────

describe("a VALID Turnstile token proceeds normally (200) and creates the lead/draft", () => {
  const email = emailFor("valid");

  it("POST with a token the always-pass secret accepts → 200 {ok:true}", async () => {
    const res = await postQuote(PASS_BASE, validFields(email, { turnstileToken: DUMMY_TOKEN }), IP_VALID);
    assert.equal(res.status, 200, `valid token should 200 (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.deepEqual(res.body, { ok: true }, "returns ONLY {ok:true}");
  });

  it("DB: a lead client_account + a DRAFT work_item (zero legs) now exist", async () => {
    const acct = (await admin.query("select id, party_id, status from client_account where login_id=$1", [email])).rows[0] as
      | { id: string; party_id: string; status: string }
      | undefined;
    assert.ok(acct, "a client_account was created");
    assert.equal(acct.status, "lead", "status is 'lead'");
    const items = (await admin.query("select id, work_state from work_item where source_party_id=$1", [acct.party_id]))
      .rows as Array<{ id: string; work_state: string }>;
    assert.equal(items.length, 1, "exactly one draft");
    assert.equal(items[0].work_state, "draft", "the work item is a DRAFT");
    const legs = Number((await admin.query("select count(*)::int as n from leg where work_item_id=$1", [items[0].id])).rows[0].n);
    assert.equal(legs, 0, "ZERO legs — a quote intake is never priced");
  });
});
