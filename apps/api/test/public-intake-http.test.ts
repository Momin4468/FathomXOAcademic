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
 * PUBLIC quote intake (Module 18 lead funnel) — BLACK-BOX HTTP tests against the
 * COMPILED app (dist/main.js). Proves the guarantees that must NEVER silently
 * break for the unauthenticated marketing-site funnel:
 *   • @Public — no auth header needed; never 401
 *   • a valid submission becomes a provisional client party + a `lead`
 *     client_account (unusable password, expires_at set, login_id = email) + a
 *     DRAFT work_item (source forced, client_account_id set) with ZERO legs
 *   • the file rule: strict brief allowlist enforced server-side (reject
 *     video/other + oversize); an allowed brief lands as file_object kind 'brief'
 *   • honeypot → silent no-op (returns ok, writes nothing)
 *   • per-IP sliding-window rate limit yields 429
 *   • duplicate email → ONE account, a SECOND draft on the same party, no leak
 *   • the not-priced invariant: never any leg, work_state never leaves 'draft'
 * Requires FEATURE_CLIENT_PORTAL + FEATURE_WORK + FEATURE_BILLING so the module
 * (and the work/billing deps it imports) mount.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3246; // dedicated test port (client-portal=3219, settlement=3218)
const BASE = `http://localhost:${PORT}`;
const QUOTE_URL = `${BASE}/public/quote`;

const ORG = "00000000-0000-4000-8000-000000000001";

// Unique per-run suffix so reruns don't collide on the login_id unique index.
const RUN = randomUUID().slice(0, 8);
const emailFor = (tag: string) => `qa-quote+${tag}-${RUN}@example.com`;

// Distinct forwarded IPs so the cheap tests aren't throttled by the rate-limit case.
const IP_MAIN = "8.8.8.8";
const IP_FILE = "8.8.4.4";
const IP_HONEYPOT = "8.8.1.1";
const IP_BADFILE = "8.8.2.2";
const IP_DUP = "8.8.3.3";
const IP_RATE = "9.9.9.9"; // the one we deliberately exceed

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

// Every email used, so teardown can clean up by login_id.
const usedEmails: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_CLIENT_PORTAL: "true",
      FEATURE_WORK: "true",
      FEATURE_BILLING: "true",
      // This suite exercises the NON-Turnstile flow (it sends no token). Pin the
      // secret OFF so it stays deterministic regardless of what `.env` provides;
      // the Turnstile gate itself is covered by public-turnstile-http.test.ts.
      TURNSTILE_SECRET_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE, 60000);
}

interface QuoteResult {
  status: number;
  body: any;
}

/**
 * POST a multipart quote via global fetch (the JSON api() helper can't do
 * multipart). `fields` are text parts; `file` (optional) is an attached brief.
 */
async function postQuote(
  fields: Record<string, string>,
  opts: { ip?: string; file?: { name: string; type: string; bytes?: BlobPart } } = {},
): Promise<QuoteResult> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (opts.file) {
    const blob = new Blob([opts.file.bytes ?? "brief contents"], { type: opts.file.type });
    form.append("file", blob, opts.file.name);
  }
  const headers: Record<string, string> = {};
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  const res = await fetch(QUOTE_URL, { method: "POST", headers, body: form });
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** A complete, valid set of text fields for a given email. */
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

/** Pull the full lead trail for an email from the DB (admin client). */
async function leadTrail(email: string) {
  const acct = (
    await admin.query(
      "select id, party_id, status, expires_at, login_id, password_hash from client_account where login_id=$1",
      [email],
    )
  ).rows;
  const account = acct[0] ?? null;
  const partyId = account?.party_id ?? null;
  const party = partyId
    ? (await admin.query("select id, party_type, contact_json from party where id=$1", [partyId])).rows[0]
    : null;
  const items = partyId
    ? (
        await admin.query(
          "select id, work_state, money_state, source_party_id, client_account_id, brief_file_id from work_item where source_party_id=$1 order by created_at",
          [partyId],
        )
      ).rows
    : [];
  return { account, party, items };
}

before(async () => {
  await admin.connect();
  await startServer();
});

after(async () => {
  // Delete only what THIS run created, matched by the unique per-run emails.
  for (const email of Array.from(new Set(usedEmails))) {
    const accounts = (await admin.query("select id, party_id from client_account where login_id=$1", [email])).rows as Array<{
      id: string;
      party_id: string;
    }>;
    // Also catch any party created with this email in contact_json that never got an account
    // (e.g. a honeypot path should NOT create one — but be defensive).
    const partyIds = new Set<string>(accounts.map((a) => a.party_id));
    const byContact = (
      await admin.query("select id from party where org_id=$1 and contact_json->>'email'=$2", [ORG, email])
    ).rows as Array<{ id: string }>;
    for (const r of byContact) partyIds.add(r.id);

    for (const pid of partyIds) {
      const items = (await admin.query("select id, brief_file_id from work_item where source_party_id=$1", [pid]))
        .rows as Array<{ id: string; brief_file_id: string | null }>;
      for (const it of items) {
        await admin.query("delete from audit_log where entity='work_item' and entity_id=$1", [it.id]);
        await admin.query("delete from leg where work_item_id=$1", [it.id]);
        await admin.query("delete from work_item where id=$1", [it.id]);
        if (it.brief_file_id) {
          await admin.query("delete from file_object where id=$1", [it.brief_file_id]);
        }
      }
      await admin.query("delete from client_account where party_id=$1", [pid]);
      await admin.query("delete from party where id=$1", [pid]);
    }
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── 1. @Public + valid quote (no file) ───────────────────────────────────────

describe("a valid public quote (no file) → 200 with NO auth, and the full lead trail", () => {
  const email = emailFor("valid");

  it("POST /public/quote (no Authorization header) → 200 {ok:true}", async () => {
    const res = await postQuote(validFields(email), { ip: IP_MAIN });
    assert.equal(res.status, 200, `valid quote should 200 (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.deepEqual(res.body, { ok: true }, "returns ONLY {ok:true} — nothing internal");
  });

  it("DB: a provisional CLIENT party exists for the email", async () => {
    const { party } = await leadTrail(email);
    assert.ok(party, "a party was created");
    assert.ok((party.party_type as string[]).includes("client"), "party_type includes 'client'");
    assert.equal(party.contact_json?.email, email, "contact email captured");
  });

  it("DB: a `lead` client_account with login_id=email, expires_at set, and a password_hash present", async () => {
    const { account } = await leadTrail(email);
    assert.ok(account, "a client_account was created");
    assert.equal(account.status, "lead", "status is 'lead'");
    assert.equal(account.login_id, email, "login_id is the email");
    assert.notEqual(account.expires_at, null, "expires_at is set (purge-able lead)");
    assert.ok(account.password_hash && String(account.password_hash).length > 0, "a password_hash exists (random/unusable)");
  });

  it("DB: a DRAFT work_item, source forced to the lead party, client_account_id set, ZERO legs", async () => {
    const { account, party, items } = await leadTrail(email);
    assert.equal(items.length, 1, "exactly one draft from this single submission");
    const wi = items[0];
    assert.equal(wi.work_state, "draft", "the work item is a DRAFT");
    assert.equal(wi.source_party_id, party.id, "source forced to the lead's own party");
    assert.equal(wi.client_account_id, account.id, "provenance marker set to the lead account");
    const legCount = Number((await admin.query("select count(*)::int as n from leg where work_item_id=$1", [wi.id])).rows[0].n);
    assert.equal(legCount, 0, "ZERO legs — a quote intake is never priced");
  });
});

// ─── 2. Valid quote WITH an allowed brief ─────────────────────────────────────

describe("a valid quote WITH an allowed brief (.txt) → 200 and a file_object kind 'brief'", () => {
  const email = emailFor("brief");

  it("POST with a text/plain brief part → 200", async () => {
    const res = await postQuote(validFields(email), {
      ip: IP_FILE,
      file: { name: "brief.txt", type: "text/plain", bytes: "My assignment brief." },
    });
    assert.equal(res.status, 200, `quote-with-brief should 200 (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.deepEqual(res.body, { ok: true });
  });

  it("DB: the draft's brief_file_id is set to a file_object kind='brief'", async () => {
    const { items } = await leadTrail(email);
    assert.equal(items.length, 1, "one draft");
    const wi = items[0];
    assert.notEqual(wi.brief_file_id, null, "brief_file_id is set");
    const fo = (await admin.query("select kind, filename, mime from file_object where id=$1", [wi.brief_file_id])).rows[0];
    assert.ok(fo, "the file_object row exists");
    assert.equal(fo.kind, "brief", "kind is 'brief'");
    assert.equal(fo.filename, "brief.txt", "original filename preserved");
  });

  it("the brief draft also has ZERO legs and stays draft (not-priced invariant)", async () => {
    const { items } = await leadTrail(email);
    const wi = items[0];
    assert.equal(wi.work_state, "draft");
    const legCount = Number((await admin.query("select count(*)::int as n from leg where work_item_id=$1", [wi.id])).rows[0].n);
    assert.equal(legCount, 0);
  });
});

// ─── 3. Disallowed file → 400, nothing created ────────────────────────────────

describe("the file rule — a disallowed brief is rejected server-side (400), nothing created", () => {
  it("an .exe (application/x-msdownload) → 400, no party/account/work_item", async () => {
    const email = emailFor("exe");
    const res = await postQuote(validFields(email), {
      ip: IP_BADFILE,
      file: { name: "x.exe", type: "application/x-msdownload", bytes: "MZ\x00\x00" },
    });
    assert.equal(res.status, 400, `.exe brief should be rejected (got ${res.status}: ${JSON.stringify(res.body)})`);
    const { account, party, items } = await leadTrail(email);
    assert.equal(account, null, "no client_account created for a rejected submission");
    assert.equal(party, null, "no party created");
    assert.equal(items.length, 0, "no work_item created");
  });

  it("a video/mp4 brief → 400, no party/account/work_item", async () => {
    const email = emailFor("video");
    const res = await postQuote(validFields(email), {
      ip: IP_BADFILE,
      file: { name: "clip.mp4", type: "video/mp4", bytes: "\x00\x00\x00\x18ftyp" },
    });
    assert.equal(res.status, 400, `video brief should be rejected (got ${res.status}: ${JSON.stringify(res.body)})`);
    const { account, party, items } = await leadTrail(email);
    assert.equal(account, null, "no client_account created");
    assert.equal(party, null, "no party created");
    assert.equal(items.length, 0, "no work_item created");
  });
});

// ─── 4. Honeypot → silent no-op ───────────────────────────────────────────────

describe("the honeypot — a filled `website` field → 200 but writes NOTHING", () => {
  const email = emailFor("honeypot");

  it("POST with website filled → 200 {ok:true}", async () => {
    const res = await postQuote(validFields(email, { website: "http://spam.example" }), { ip: IP_HONEYPOT });
    assert.equal(res.status, 200, `honeypot should still 200 (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.deepEqual(res.body, { ok: true });
  });

  it("DB: NO client_account, NO party, NO work_item for that email", async () => {
    const { account, party, items } = await leadTrail(email);
    assert.equal(account, null, "honeypot must not create an account");
    assert.equal(party, null, "honeypot must not create a party");
    assert.equal(items.length, 0, "honeypot must not create a work_item");
  });
});

// ─── 5. Per-IP rate limit → 429 ───────────────────────────────────────────────

describe("per-IP rate limit — exceeding the cap from one IP yields at least one 429", () => {
  it("~7 submissions from the same forwarded IP → at least one 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await postQuote(validFields(emailFor(`rate${i}`)), { ip: IP_RATE });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 in ${JSON.stringify(statuses)} (default cap 5/hour)`);
    assert.ok(
      statuses.filter((s) => s === 200).length <= 5,
      `at most the cap (5) should succeed; got ${JSON.stringify(statuses)}`,
    );
  });
});

// ─── 6. Duplicate email → ONE account, a SECOND draft ─────────────────────────

describe("a duplicate email — both 200, ONE account, a SECOND draft on the same party", () => {
  const email = emailFor("dup");

  it("two submissions with the same email both → 200", async () => {
    const r1 = await postQuote(validFields(email), { ip: IP_DUP });
    const r2 = await postQuote(validFields(email), { ip: IP_DUP });
    assert.equal(r1.status, 200, `first dup should 200 (got ${r1.status}: ${JSON.stringify(r1.body)})`);
    assert.equal(r2.status, 200, `second dup should 200 (got ${r2.status}: ${JSON.stringify(r2.body)})`);
  });

  it("DB: exactly ONE client_account, but TWO draft work_items on the same party", async () => {
    const acctCount = Number(
      (await admin.query("select count(*)::int as n from client_account where login_id=$1", [email])).rows[0].n,
    );
    assert.equal(acctCount, 1, "the email maps to exactly one client_account (login_id unique, reused)");
    const { account, party, items } = await leadTrail(email);
    assert.equal(items.length, 2, "the second submission attaches a SECOND draft to the same party");
    for (const wi of items) {
      assert.equal(wi.work_state, "draft", "both are drafts");
      assert.equal(wi.source_party_id, party.id, "both sourced to the same lead party");
      assert.equal(wi.client_account_id, account.id, "both tagged to the same account");
    }
  });
});

// ─── 7. Not-priced invariant across everything ────────────────────────────────

describe("the not-priced invariant holds across ALL drafts created this run", () => {
  it("no leg row exists for any work_item created from a public quote this run", async () => {
    let totalDrafts = 0;
    for (const email of Array.from(new Set(usedEmails))) {
      const { party } = await leadTrail(email);
      if (!party) continue;
      const rows = (await admin.query("select id, work_state from work_item where source_party_id=$1", [party.id]))
        .rows as Array<{ id: string; work_state: string }>;
      for (const wi of rows) {
        totalDrafts++;
        assert.equal(wi.work_state, "draft", `work_item ${wi.id} must still be draft`);
        const n = Number((await admin.query("select count(*)::int as n from leg where work_item_id=$1", [wi.id])).rows[0].n);
        assert.equal(n, 0, `work_item ${wi.id} must have ZERO legs`);
      }
    }
    assert.ok(totalDrafts > 0, "this run created at least one draft to assert over");
  });
});

// ─── 8. @Public sanity — no auth ever yields 401 ──────────────────────────────

describe("@Public — the endpoint never requires auth", () => {
  it("a malformed body (missing required fields) with NO token → 400, not 401", async () => {
    const res = await postQuote({ name: "Only a name" }, { ip: IP_MAIN });
    assert.equal(res.status, 400, `boundary validation rejects malformed input (got ${res.status}: ${JSON.stringify(res.body)})`);
  });
});
