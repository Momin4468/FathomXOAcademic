import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type pg from "pg";

/**
 * A cleanly-cordoned DEMO org (Phase 6) — "Demo Org — Training". Fully separate
 * from the real seed org (00000000-…-0001), so it can be wiped in one action with
 * ZERO effect on any other org. All ids carry a recognizable `de510000` prefix
 * (RFC-4122 v4-shaped so they pass @IsUUID validation). Seed is re-runnable: it
 * wipes the demo org first, then inserts fresh. NOT production data — every login
 * is Password123!.
 */
export const DEMO_ORG = "de510000-0000-4000-8000-000000000001";
export const DEMO_PF_ACCOUNT = "de510000-0000-4000-8000-0000000000f1";

const ROLE = {
  sysSuper: "de510000-0000-4000-8000-0000000000a1",
  bizSuper: "de510000-0000-4000-8000-0000000000a2",
  admin: "de510000-0000-4000-8000-0000000000a3",
  writer: "de510000-0000-4000-8000-0000000000a6",
  vendor: "de510000-0000-4000-8000-0000000000a8",
  referrer: "de510000-0000-4000-8000-0000000000a9",
};

// Every module the app knows, so the demo SuperAdmin/Admins can exercise everything.
const MODULES = [
  "platform", "reference", "work", "rules", "capture", "billing", "expenses",
  "dashboard", "credential_vault", "outcomes", "checks", "knowledge", "custom_fields",
  "referrers", "channels", "notifications", "advances", "vendor", "hrm",
  "import_export", "ai_capture", "client_portal", "settlement",
];
const ACTIONS = ["view", "create", "edit", "approve"];

/** Wipe every demo row — business plane by org_id, PF plane by pf_account_id. */
export async function wipeDemo(client: pg.Client): Promise<void> {
  // PF plane first (child → parent).
  for (const t of ["pf_investment_event", "pf_investment", "pf_income", "pf_expense", "pf_category", "pf_audit_log", "pf_refresh_token"]) {
    await client.query(`delete from ${t} where pf_account_id = $1`, [DEMO_PF_ACCOUNT]);
  }
  await client.query(`delete from pf_account where id = $1`, [DEMO_PF_ACCOUNT]);
  // Business plane, child → parent (FK-safe order).
  for (const t of [
    "task", "payment_allocation", "payment", "invoice_line", "invoice", "leg",
    "work_line", "work_item", "price_group", "opening_balance", "channel",
    "notification", "audit_log", "user_role", "user_account", "permission", "party", "role",
  ]) {
    await client.query(`delete from ${t} where org_id = $1`, [DEMO_ORG]);
  }
  await client.query(`delete from org where id = $1`, [DEMO_ORG]);
}

/** Wipe, then insert the full demo dataset. */
export async function seedDemo(client: pg.Client): Promise<void> {
  await wipeDemo(client);
  const q = (text: string, params: unknown[] = []) => client.query(text, params);
  const pw = await bcrypt.hash("Password123!", 12);
  const today = new Date().toISOString().slice(0, 10);
  const past = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // ─── Org + roles ────────────────────────────────────────────────────────────
  await q(`insert into org (id, name) values ($1, $2)`, [DEMO_ORG, "Demo Org — Training"]);
  await q(
    `insert into role (id, org_id, name, is_system) values
      ($1,$7,'System SuperAdmin',true),($2,$7,'Business SuperAdmin',true),($3,$7,'Admin',true),
      ($4,$7,'Writer',true),($5,$7,'Vendor',true),($6,$7,'Referrer',true)`,
    [ROLE.sysSuper, ROLE.bizSuper, ROLE.admin, ROLE.writer, ROLE.vendor, ROLE.referrer, DEMO_ORG],
  );

  // ─── Permissions: SuperAdmin + Admin get everything; others scoped ───────────
  const grants: Array<[string, string, string]> = [];
  for (const m of MODULES) for (const a of ACTIONS) { grants.push([ROLE.sysSuper, m, a]); grants.push([ROLE.admin, m, a]); }
  for (const m of MODULES) grants.push([ROLE.bizSuper, m, "view"]);
  for (const [m, a] of [["work", "view"], ["work", "create"], ["capture", "view"], ["capture", "create"]] as const) grants.push([ROLE.writer, m, a]);
  for (const [m, a] of [["vendor", "view"], ["vendor", "create"]] as const) grants.push([ROLE.vendor, m, a]);
  for (const [m, a] of [["channels", "view"], ["referrers", "view"]] as const) grants.push([ROLE.referrer, m, a]);
  for (const [roleId, m, a] of grants) {
    await q(`insert into permission (org_id, role_id, module, action) values ($1,$2,$3,$4) on conflict do nothing`, [DEMO_ORG, roleId, m, a]);
  }

  // ─── Parties ────────────────────────────────────────────────────────────────
  const P = {
    momin: randomUUID(), emon: randomUUID(), humaira: randomUUID(), mitul: randomUUID(),
    toma: randomUUID(), lemon: randomUUID(), rahim: randomUUID(), karim: randomUUID(),
    emad: randomUUID(), nabil: randomUUID(), facebook: randomUUID(),
  };
  const party = (id: string, name: string, types: string[], ref?: string) =>
    q(`insert into party (id, org_id, display_name, party_type, external_ref) values ($1,$2,$3,$4::text[],$5)`,
      [id, DEMO_ORG, name, types, ref ?? null]);
  await party(P.momin, "Momin (demo)", ["partner", "writer"]);
  await party(P.emon, "Emon (demo)", ["partner"]);
  await party(P.humaira, "Humaira", ["writer"]);
  await party(P.mitul, "Mitul", ["writer"]);
  await party(P.toma, "Toma Apu", ["vendor"]);
  await party(P.lemon, "Lemon", ["partner", "referrer"]);
  await party(P.rahim, "Rahim Ahmed", ["client"], "DIU-101");
  await party(P.karim, "Karim Uddin", ["client"], "DIU-102");
  await party(P.emad, "Emad (cohort)", ["client"], "DIU-201");
  await party(P.nabil, "Nabil (cohort)", ["client"], "DIU-202");
  await party(P.facebook, "Facebook", ["channel"]);

  // ─── Users (all Password123!) ────────────────────────────────────────────────
  const U = { sys: randomUUID(), momin: randomUUID(), emon: randomUUID(), humaira: randomUUID(), mitul: randomUUID(), toma: randomUUID(), lemon: randomUUID() };
  const user = (id: string, email: string, partyId: string | null) =>
    q(`insert into user_account (id, org_id, email, password_hash, status, party_id) values ($1,$2,$3,$4,'active',$5)`,
      [id, DEMO_ORG, email, pw, partyId]);
  await user(U.sys, "sysadmin@demo.local", null);
  await user(U.momin, "momin@demo.local", P.momin);
  await user(U.emon, "emon@demo.local", P.emon);
  await user(U.humaira, "humaira@demo.local", P.humaira);
  await user(U.mitul, "mitul@demo.local", P.mitul);
  await user(U.toma, "toma@demo.local", P.toma);
  await user(U.lemon, "lemon@demo.local", P.lemon);
  const assign = (uid: string, rid: string) =>
    q(`insert into user_role (org_id, user_id, role_id) values ($1,$2,$3)`, [DEMO_ORG, uid, rid]);
  await assign(U.sys, ROLE.sysSuper);
  await assign(U.momin, ROLE.admin); await assign(U.momin, ROLE.writer);
  await assign(U.emon, ROLE.admin);
  await assign(U.humaira, ROLE.writer); await assign(U.mitul, ROLE.writer);
  await assign(U.toma, ROLE.vendor); await assign(U.lemon, ROLE.referrer);

  // ─── Jobs at different lifecycle states ──────────────────────────────────────
  const job = (opts: {
    id: string; title: string; workState: string; moneyState?: string; source?: string; client?: string; doer?: string;
    module?: string; groupKind?: string; groupScope?: string; delivery?: string; words?: number;
  }) =>
    q(`insert into work_item (id, org_id, title, work_state, money_state, source_party_id, client_party_id, doer_party_id,
        module_name, group_kind, group_scope, delivery_date, word_count, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [opts.id, DEMO_ORG, opts.title, opts.workState, opts.moneyState ?? "unbilled", opts.source ?? null, opts.client ?? null,
       opts.doer ?? null, opts.module ?? null, opts.groupKind ?? "individual", opts.groupScope ?? null,
       opts.delivery ?? null, opts.words ?? null, U.momin]);
  const line = (opts: {
    id: string; job: string; kind?: string; status: string; consumer?: string; writer?: string;
    clientRate?: number; writerRate?: number; fixed?: number; words?: number; priceGroup?: string; sourceLine?: string;
  }) =>
    q(`insert into work_line (id, org_id, work_item_id, line_kind, line_status, consumer_party_id, writer_party_id,
        word_count, unit_count, client_rate, writer_rate, fixed_amount, price_group_id, source_line_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$13)`,
      [opts.id, DEMO_ORG, opts.job, opts.kind ?? "part", opts.status, opts.consumer ?? null, opts.writer ?? null,
       opts.words ?? null, opts.clientRate ?? null, opts.writerRate ?? null, opts.fixed ?? null, opts.priceGroup ?? null, opts.sourceLine ?? null]);
  const leg = (job: string, seq: number, from: string | null, to: string | null, amount: number) =>
    q(`insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), DEMO_ORG, job, seq, from, to, String(amount), U.momin]);

  // Job A — delivered & settled (direct: Rahim pays, Humaira writes).
  const jobA = randomUUID(), jobAConsumer = randomUUID(), jobAProducer = randomUUID();
  await job({ id: jobA, title: "ICT701 A3 — report", workState: "delivered", moneyState: "settled", source: P.rahim, client: P.rahim, doer: P.humaira, module: "Information & Communication Technology", delivery: past(20), words: 2000 });
  await line({ id: jobAProducer, job: jobA, status: "submitted", writer: P.humaira, fixed: 3000, words: 2000 });
  await line({ id: jobAConsumer, job: jobA, status: "billed", consumer: P.rahim, fixed: 5000, words: 2000 });
  await leg(jobA, 1, P.rahim, P.momin, 5000);
  await leg(jobA, 2, P.momin, P.humaira, 3000);
  // Invoice + payment (settled).
  const invA = randomUUID(), invLineA = randomUUID(), payA = randomUUID();
  await q(`insert into invoice (id, org_id, client_party_id, status, created_by) values ($1,$2,$3,'paid',$4)`, [invA, DEMO_ORG, P.rahim, U.momin]);
  await q(`insert into invoice_line (id, org_id, invoice_id, work_line_id, amount) values ($1,$2,$3,$4,$5)`, [invLineA, DEMO_ORG, invA, jobAConsumer, "5000"]);
  await q(`insert into payment (id, org_id, direction, counterparty_party_id, amount, paid_at, medium, created_by) values ($1,$2,'in',$3,$4,now(),'bank',$5)`, [payA, DEMO_ORG, P.rahim, "5000", U.momin]);
  await q(`insert into payment_allocation (id, org_id, payment_id, invoice_line_id, amount) values ($1,$2,$3,$4,$5)`, [randomUUID(), DEMO_ORG, payA, invLineA, "5000"]);

  // Job B — confirmed, referral-sourced (Lemon), line submitted.
  const jobB = randomUUID();
  await job({ id: jobB, title: "MBA Thesis — Proposal", workState: "confirmed", source: P.lemon, client: P.karim, doer: P.mitul, module: "Business Administration", words: 3500 });
  await line({ id: randomUUID(), job: jobB, status: "submitted", consumer: P.karim, fixed: 8000 });
  await leg(jobB, 1, P.karim, P.emon, 8000);
  await leg(jobB, 2, P.emon, P.mitul, 5000);

  // Job C — pending.
  const jobC = randomUUID();
  await job({ id: jobC, title: "BBA Marketing Essay", workState: "pending", source: P.karim, client: P.karim, doer: P.humaira, words: 1500 });
  await line({ id: randomUUID(), job: jobC, status: "pending", consumer: P.karim, fixed: 3000 });

  // Job D — a cancelled line.
  const jobD = randomUUID();
  await job({ id: jobD, title: "HR Report (withdrawn)", workState: "pending", source: P.rahim, client: P.rahim, doer: P.mitul });
  await line({ id: randomUUID(), job: jobD, status: "cancelled", consumer: P.rahim, fixed: 2500 });

  // Job E — a bulk-priced cohort course (price_group; anchor carries the combined sum).
  const jobE = randomUUID(), pg = randomUUID(), anchor = randomUUID(), sibling = randomUUID();
  await job({ id: jobE, title: "BMMB7001 Cohort — group assignment", workState: "confirmed", client: P.emad, doer: P.humaira, module: "Managing Business", groupKind: "group", groupScope: "full" });
  await q(`insert into price_group (id, org_id, client_party_id, note, created_by) values ($1,$2,$3,$4,$5)`, [pg, DEMO_ORG, P.emad, "BMMB7001 cohort — one combined price", U.momin]);
  await line({ id: anchor, job: jobE, status: "submitted", consumer: P.emad, fixed: 12000, priceGroup: pg });
  await line({ id: sibling, job: jobE, status: "submitted", consumer: P.nabil, fixed: 0, priceGroup: pg });

  // ─── Channel + opening balance + a linked task ───────────────────────────────
  await q(`insert into channel (id, org_id, party_id, controller_party_id, medium, is_active, created_by) values ($1,$2,$3,null,'facebook',true,$4)`, [randomUUID(), DEMO_ORG, P.facebook, U.momin]);
  await q(`insert into opening_balance (id, org_id, party_id, amount, currency, as_of, note, created_by) values ($1,$2,$3,$4,'BDT',$5,$6,$7)`,
    [randomUUID(), DEMO_ORG, P.humaira, "2000", past(90), "Carried-over earnings at go-live (demo)", U.momin]);
  await q(`insert into task (id, org_id, title, state, work_item_id, assignee_party_id, created_by) values ($1,$2,$3,'open',$4,$5,$6)`,
    [randomUUID(), DEMO_ORG, "Deliver ICT701 A3 final", jobA, P.humaira, U.momin]);

  // ─── Personal Finance plane (private) — a demo account with entries + investment ─
  await q(`insert into pf_account (id, email, password_hash, status, display_name, base_currency) values ($1,$2,$3,'active','Demo (PF)','BDT')`, [DEMO_PF_ACCOUNT, "pf-demo@demo.local", pw]);
  const catInc = randomUUID(), catExp = randomUUID(), catInv = randomUUID();
  await q(
    `insert into pf_category (id, pf_account_id, kind, name) values
      ($2,$1,'income','Salary'),($3,$1,'expense','Rent'),($4,$1,'investment','Stocks')`,
    [DEMO_PF_ACCOUNT, catInc, catExp, catInv],
  );
  await q(`insert into pf_income (id, pf_account_id, category_id, amount, currency, occurred_on, note) values ($1,$2,$3,$4,'BDT',$5,$6)`, [randomUUID(), DEMO_PF_ACCOUNT, catInc, "30000", past(15), "Monthly salary"]);
  await q(`insert into pf_expense (id, pf_account_id, category_id, amount, currency, occurred_on, note) values ($1,$2,$3,$4,'BDT',$5,$6)`, [randomUUID(), DEMO_PF_ACCOUNT, catExp, "12000", past(10), "Flat rent"]);
  const inv = randomUUID();
  await q(`insert into pf_investment (id, pf_account_id, category_id, name, principal, currency, started_on, note) values ($1,$2,$3,$4,$5,'BDT',$6,$7)`, [inv, DEMO_PF_ACCOUNT, catInv, "DSE Stocks", "50000", past(120), "Demo holding"]);
  await q(`insert into pf_investment_event (id, pf_account_id, investment_id, kind, amount, occurred_on, note) values ($1,$2,$3,'valuation',$4,$5,$6)`, [randomUUID(), DEMO_PF_ACCOUNT, inv, "55000", past(5), "Latest mark"]);
}
