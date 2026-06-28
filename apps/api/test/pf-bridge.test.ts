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
 * The ONE-WAY income bridge + link seam + plane independence (DESIGN_SPEC §11) —
 * BLACK-BOX HTTP. The bridge is the only join between the business and PF planes
 * and it must be: one-way, idempotent, reversible to zero, and linked-only.
 *   • a business out-payment allocated to a LINKED writer party pushes exactly one
 *     pf_income (source_ref = the allocation id); re-allocating is idempotent;
 *   • reversing the payment pushes a NEGATIVE mirror → net income for that party
 *     nets to 0 (append-only correction, never an edit);
 *   • a payout to an UNLINKED party pushes NO pf_income;
 *   • backfill: linking AFTER a payout exists pulls it in on consume (idempotent);
 *   • link tokens are single-use (second consume → 400/409) and bad/expired → 400;
 *   • DEACTIVATING the business user_account does NOT break PF login (decoupled).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3243;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-pf-bridge-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin: billing:* (records payouts + allocations)

const createdPfAccountIds: string[] = [];
const createdPartyIds: string[] = [];
const createdUserIds: string[] = [];
let pgToday = "";
function datePlus(days: number): string {
  const d = new Date(`${pgToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_PERSONAL_FINANCE: "true",
      FEATURE_BILLING: "true",
      FEATURE_EXPENSES: "true",
      EMAIL_ADAPTER: "dev",
      EMAIL_OUTBOX_DIR: OUTBOX,
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

async function registerPf(): Promise<{ token: string; id: string; email: string }> {
  const email = `pf+${randomUUID()}@pf.test`;
  const res = await api(BASE, "/pf/auth/register", {
    method: "POST",
    body: { email, password: DEV_PASSWORD, displayName: "BRIDGE", baseCurrency: "BDT" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const token = res.body.accessToken as string;
  const me = await api(BASE, "/pf/auth/me", { token });
  createdPfAccountIds.push(me.body.id as string);
  return { token, id: me.body.id as string, email };
}

/** A fresh writer party + a business login linked to it (so it can mint a link-token). */
async function makeWriterWithLogin(label: string): Promise<{ partyId: string; token: string; userId: string }> {
  const partyId = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,'{writer}')", [partyId, ORG, `BRIDGE ${label}`]);
  createdPartyIds.push(partyId);
  const email = `bridge+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD, partyId } });
  assert.equal(created.status, 201, `user create (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the writer's business login works");
  return { partyId, token: li.body.accessToken as string, userId };
}

/** Mint a link-token as a business user (their party) and consume it in a PF account. */
async function linkPfToParty(businessToken: string, pfToken: string): Promise<{ backfilled: number }> {
  const mint = await api(BASE, "/me/personal-finance/link-token", { method: "POST", token: businessToken });
  assert.equal(mint.status, 201, `mint link-token (got ${mint.status}: ${JSON.stringify(mint.body)})`);
  const consume = await api(BASE, "/pf/link", { method: "POST", token: pfToken, body: { code: mint.body.code } });
  assert.equal(consume.status, 200, `consume link-token (got ${consume.status}: ${JSON.stringify(consume.body)})`);
  assert.equal(consume.body.linked, true, "link is established");
  return { backfilled: Number(consume.body.backfilled) };
}

/** Record an out-payment to a writer party and allocate it to that party. Returns paymentId. */
async function payoutToWriter(writerPartyId: string, amount: number, paidAt: string): Promise<{ paymentId: string }> {
  const pay = await api(BASE, "/payments", { method: "POST", token: mominToken, body: { direction: "out", amount, paidAt, counterpartyPartyId: writerPartyId } });
  assert.equal(pay.status, 201, `payout (got ${pay.status}: ${JSON.stringify(pay.body)})`);
  const alloc = await api(BASE, `/payments/${pay.body.id}/allocate`, { method: "POST", token: mominToken, body: { items: [{ writerPartyId, amount }] } });
  assert.equal(alloc.status, 201, `allocate (got ${alloc.status}: ${JSON.stringify(alloc.body)})`);
  return { paymentId: pay.body.id as string };
}

/** Read the PF account's income directly (server returns it under PF RLS; we use the PF token). */
async function pfIncome(pfToken: string): Promise<Array<any>> {
  const res = await api(BASE, "/pf/income", { token: pfToken });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as Array<any>;
}

before(async () => {
  await admin.connect();
  pgToday = (await admin.query("select current_date::text as d")).rows[0].d as string;
  await startServer();
  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200);
  sysToken = s.body.accessToken;
  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;
});

after(async () => {
  // Unlink first so pf_account FK / unique index doesn't block party cleanup.
  for (const id of createdPfAccountIds) {
    await admin.query("update pf_account set linked_party_id = null where id=$1", [id]);
    await admin.query("delete from pf_income where pf_account_id=$1", [id]);
    await admin.query("delete from pf_category where pf_account_id=$1", [id]);
    await admin.query("delete from pf_audit_log where pf_account_id=$1", [id]);
    await admin.query("delete from pf_refresh_token where pf_account_id=$1", [id]);
    await admin.query("delete from pf_account where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    await admin.query("delete from pf_link_token where party_id=$1", [id]);
    await admin.query("delete from payment_allocation where writer_party_id=$1", [id]);
    await admin.query("delete from payment_allocation where payment_id in (select id from payment where counterparty_party_id=$1)", [id]);
    await admin.query("delete from payment where counterparty_party_id=$1", [id]);
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

describe("the one-way income bridge pushes a payout into a LINKED PF plane", () => {
  it("a payout to a linked writer creates exactly one pf_income (source_ref = allocation id)", async () => {
    const w = await makeWriterWithLogin("LinkedPayout");
    const pf = await registerPf();
    await linkPfToParty(w.token, pf.token);

    await payoutToWriter(w.partyId, 4000, datePlus(-1));

    const inc = await pfIncome(pf.token);
    const payouts = inc.filter((r) => r.source === "business_payout");
    assert.equal(payouts.length, 1, "exactly one business_payout income row appeared");
    assert.equal(Number(payouts[0].amount), 4000, "income amount = the payout amount");

    // source_ref = the originating payment_allocation id (idempotency key).
    const allocRow = await admin.query(
      "select id from payment_allocation where writer_party_id=$1 and amount='4000'",
      [w.partyId],
    );
    assert.equal(allocRow.rows.length, 1, "one allocation exists");
    assert.equal(payouts[0].sourceRef, allocRow.rows[0].id, "pf_income.source_ref = the allocation id");
  });

  it("reversing the payout pushes a NEGATIVE mirror → the party's net business income nets to 0", async () => {
    const w = await makeWriterWithLogin("ReversePayout");
    const pf = await registerPf();
    await linkPfToParty(w.token, pf.token);

    const { paymentId } = await payoutToWriter(w.partyId, 2500, datePlus(-2));
    const rev = await api(BASE, `/payments/${paymentId}/reverse`, { method: "POST", token: mominToken, body: { reason: "test" } });
    assert.equal(rev.status, 201, `reverse payment (got ${rev.status}: ${JSON.stringify(rev.body)})`);

    const inc = await pfIncome(pf.token);
    const payouts = inc.filter((r) => r.source === "business_payout");
    assert.equal(payouts.length, 2, "a positive + a negative mirror (append-only, never edited)");
    const net = payouts.reduce((s, r) => s + Number(r.amount), 0);
    assert.equal(net, 0, "reversal mirror nets the business income to 0");
  });

  it("a payout to an UNLINKED party creates NO pf_income", async () => {
    const w = await makeWriterWithLogin("Unlinked");
    const pf = await registerPf(); // registered but NOT linked to this party
    await payoutToWriter(w.partyId, 1500, datePlus(-1));

    // The PF account that exists but isn't linked sees nothing.
    const inc = await pfIncome(pf.token);
    assert.equal(inc.filter((r) => r.source === "business_payout").length, 0, "no income — the party isn't linked");
    // And no pf_income row exists for this allocation anywhere (admin-wide check).
    const any = await admin.query(
      "select count(*)::int n from pf_income where source_party_id=$1",
      [w.partyId],
    );
    assert.equal(any.rows[0].n, 0, "the bridge pushed nothing for an unlinked party");
  });
});

describe("backfill: linking AFTER a payout pulls past payouts in (idempotent)", () => {
  it("consume returns the backfilled count; re-consuming is impossible (single-use)", async () => {
    const w = await makeWriterWithLogin("Backfill");
    // Two payouts BEFORE any link exists.
    await payoutToWriter(w.partyId, 1000, datePlus(-5));
    await payoutToWriter(w.partyId, 700, datePlus(-3));

    const pf = await registerPf();
    const { backfilled } = await linkPfToParty(w.token, pf.token);
    assert.equal(backfilled, 2, "both past payouts were backfilled on link");

    const inc = await pfIncome(pf.token);
    const payouts = inc.filter((r) => r.source === "business_payout");
    assert.equal(payouts.length, 2, "both payouts now present as income");
    assert.equal(payouts.reduce((s, r) => s + Number(r.amount), 0), 1700, "backfilled amounts sum to the payouts");

    // A NEW payout after linking flows live via the bridge (still idempotent set).
    await payoutToWriter(w.partyId, 300, datePlus(-1));
    const inc2 = await pfIncome(pf.token);
    assert.equal(inc2.filter((r) => r.source === "business_payout").length, 3, "the live payout adds exactly one more");
  });
});

describe("link tokens are single-use and reject bad/expired codes", () => {
  it("a second consume of the same code → 400/409", async () => {
    const w = await makeWriterWithLogin("SingleUse");
    const pf1 = await registerPf();
    const mint = await api(BASE, "/me/personal-finance/link-token", { method: "POST", token: w.token });
    assert.equal(mint.status, 201);
    const code = mint.body.code as string;

    const first = await api(BASE, "/pf/link", { method: "POST", token: pf1.token, body: { code } });
    assert.equal(first.status, 200, "first consume succeeds");

    // A second account tries the same (already consumed) code.
    const pf2 = await registerPf();
    const second = await api(BASE, "/pf/link", { method: "POST", token: pf2.token, body: { code } });
    assert.ok([400, 409].includes(second.status), `a consumed code is rejected (got ${second.status})`);
  });

  it("a garbage code → 400", async () => {
    const pf = await registerPf();
    const res = await api(BASE, "/pf/link", { method: "POST", token: pf.token, body: { code: "not-a-real-code" } });
    assert.equal(res.status, 400, "an unknown code is invalid");
  });

  it("an expired code → 400", async () => {
    const w = await makeWriterWithLogin("Expired");
    const pf = await registerPf();
    const mint = await api(BASE, "/me/personal-finance/link-token", { method: "POST", token: w.token });
    assert.equal(mint.status, 201);
    // Force-expire the just-minted token via admin (hash matches the latest unconsumed for this party).
    await admin.query(
      "update pf_link_token set expires_at = now() - interval '1 minute' where party_id=$1 and consumed_at is null",
      [w.partyId],
    );
    const res = await api(BASE, "/pf/link", { method: "POST", token: pf.token, body: { code: mint.body.code } });
    assert.equal(res.status, 400, "an expired code is rejected");
  });
});

describe("plane independence: deactivating the business login does NOT disable PF", () => {
  it("a linked PF account still logs in after its business user_account is deactivated", async () => {
    const w = await makeWriterWithLogin("Decouple");
    const pf = await registerPf();
    await linkPfToParty(w.token, pf.token);

    // Deactivate the BUSINESS user_account (PF status is independent).
    await admin.query("update user_account set status='deactivated' where id=$1", [w.userId]);
    // Sanity: the business login is now refused.
    const biz = await login((await admin.query("select email from user_account where id=$1", [w.userId])).rows[0].email, DEV_PASSWORD);
    assert.notEqual(biz.status, 200, "the deactivated business login is refused");

    // The PF login still works — the planes are decoupled.
    const me = await api(BASE, "/pf/auth/me", { token: pf.token });
    assert.equal(me.status, 200, "the existing PF token still resolves the account");
    const li = await api(BASE, "/pf/auth/login", { method: "POST", body: { email: pf.email, password: DEV_PASSWORD } });
    assert.equal(li.status, 200, "a fresh PF login succeeds despite the deactivated business account");
  });
});
