import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type pg from "pg";

/**
 * A cleanly-cordoned DEMO org — "Demo Org — Training". Fully separate from the real
 * seed org, wipeable in ONE action with ZERO effect on any other org. Re-runnable
 * (wipes first). ~10 of each type + a pre-filled academic directory, and every job
 * carries legs so the board margins + dashboard populate. NOT production data —
 * every login is Password123!.
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

const MODULES = [
  "platform", "reference", "work", "rules", "capture", "billing", "expenses",
  "dashboard", "credential_vault", "outcomes", "checks", "knowledge", "custom_fields",
  "referrers", "channels", "notifications", "advances", "vendor", "hrm",
  "import_export", "ai_capture", "client_portal", "settlement",
];
const ACTIONS = ["view", "create", "edit", "approve"];

/** Wipe every demo row — business plane by org_id, PF plane by pf_account_id. */
export async function wipeDemo(client: pg.Client): Promise<void> {
  // Every pf_* child table (all carry pf_account_id), FK-safe child→parent order so
  // the final pf_account delete can't be blocked. Includes the later-migration
  // tables (savings/loans/notes/targets/subscriptions + the 0035 planner tables
  // pf_preferences/pf_anomaly_notice/pf_ai_usage) — a lazily-created row in any of
  // them previously blocked the wipe.
  for (const t of [
    "pf_investment_event", "pf_investment", "pf_saving_event", "pf_saving",
    "pf_loan_event", "pf_loan", "pf_note_attachment", "pf_note",
    "pf_income", "pf_expense", "pf_category", "pf_cash_checkin",
    "pf_target", "pf_subscription", "pf_anomaly_notice", "pf_ai_usage",
    "pf_preferences", "pf_audit_log", "pf_refresh_token",
  ]) {
    await client.query(`delete from ${t} where pf_account_id = $1`, [DEMO_PF_ACCOUNT]);
  }
  await client.query(`delete from pf_account where id = $1`, [DEMO_PF_ACCOUNT]);
  // Login refresh tokens reference the demo users — clear them before the users.
  await client.query(`delete from auth_refresh_token where user_id in (select id from user_account where org_id = $1)`, [DEMO_ORG]);
  for (const t of [
    "task", "payment_allocation", "payment", "expense", "invoice_line", "invoice", "leg",
    "work_line", "work_item", "price_group", "deal_term", "opening_balance", "channel",
    "notification", "audit_log", "user_role", "user_account", "permission",
    "cover_sheet_template", "ref_alias", "party", "ref_entity", "role",
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
  const past = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // ─── Org + roles + permissions ────────────────────────────────────────────────
  await q(`insert into org (id, name) values ($1, $2)`, [DEMO_ORG, "Demo Org — Training"]);
  await q(
    `insert into role (id, org_id, name, is_system) values
      ($1,$7,'System SuperAdmin',true),($2,$7,'Business SuperAdmin',true),($3,$7,'Admin',true),
      ($4,$7,'Writer',true),($5,$7,'Vendor',true),($6,$7,'Referrer',true)`,
    [ROLE.sysSuper, ROLE.bizSuper, ROLE.admin, ROLE.writer, ROLE.vendor, ROLE.referrer, DEMO_ORG],
  );
  const grants: Array<[string, string, string]> = [];
  for (const m of MODULES) for (const a of ACTIONS) { grants.push([ROLE.sysSuper, m, a]); grants.push([ROLE.admin, m, a]); }
  for (const m of MODULES) grants.push([ROLE.bizSuper, m, "view"]);
  for (const [m, a] of [["work", "view"], ["work", "create"], ["capture", "view"], ["capture", "create"]] as const) grants.push([ROLE.writer, m, a]);
  for (const [m, a] of [["vendor", "view"], ["vendor", "create"]] as const) grants.push([ROLE.vendor, m, a]);
  for (const [m, a] of [["channels", "view"], ["referrers", "view"]] as const) grants.push([ROLE.referrer, m, a]);
  for (const [roleId, m, a] of grants) {
    await q(`insert into permission (org_id, role_id, module, action) values ($1,$2,$3,$4) on conflict do nothing`, [DEMO_ORG, roleId, m, a]);
  }

  // ─── Academic directory (pre-filled: universities → courses + referencing style) ─
  const refId = new Map<string, string>();
  const refEntity = async (key: string, kind: string, canonical: string, parentKey?: string, meta?: Record<string, unknown>) => {
    const id = randomUUID();
    refId.set(key, id);
    await q(`insert into ref_entity (id, org_id, kind, canonical, parent_id, status, meta_json) values ($1,$2,$3,$4,$5,'confirmed',$6)`,
      [id, DEMO_ORG, kind, canonical, parentKey ? refId.get(parentKey) : null, JSON.stringify(meta ?? {})]);
    await q(`insert into ref_alias (id, org_id, ref_id, alias, normalized) values ($1,$2,$3,$4,$5)`,
      [randomUUID(), DEMO_ORG, id, canonical, norm(canonical)]);
    return id;
  };
  const unis: Array<[string, string]> = [
    ["uwe", "UWE Bristol"], ["londonmet", "London Metropolitan University"], ["coventry", "Coventry University"],
    ["bathspa", "Bath Spa University"], ["uwtsd", "UW Trinity Saint David"], ["koi", "King's Own Institute"],
    ["victoria", "Victoria University"], ["anglia", "Anglia Ruskin University"], ["northumbria", "Northumbria University"],
    ["diu", "Daffodil International University"],
  ];
  for (const [k, name] of unis) await refEntity(`u:${k}`, "university", name);
  const courses: Array<[string, string, string]> = [
    ["UMKCQT", "uwe", "Customer Needs & UX"], ["UMOCQW", "uwe", "People & Organisations"], ["UMAD47", "uwe", "Managing Finance"],
    ["COMP7032M", "londonmet", "AI Concepts"], ["COMP7033M", "londonmet", "Cloud Computing"],
    ["BMG704", "coventry", "International Finance"], ["MKT744", "coventry", "Global Marketing"],
    ["MSCCOMP", "bathspa", "MSc Computing Project"], ["CYB701", "uwtsd", "Cyber Security"],
    ["ICT701", "koi", "Project Management"], ["ICT726", "koi", "Web Development"], ["ICT751", "koi", "UI/UX"],
    ["BUS500", "victoria", "Business Strategy"], ["ISYS704", "anglia", "Information Systems"], ["MBA701", "diu", "Research Methods"],
  ];
  const courseName = new Map<string, string>();
  // Course descriptive meta lives on meta_json (name/program/referencing) — powers
  // the flat Academic grid + task auto-fill (handoff §13).
  const REFS = ["APA 7th", "Harvard", "IEEE"];
  const PROGRAM: Record<string, string> = {
    uwe: "MBA", londonmet: "MSc Computer Science", coventry: "MBA Finance", bathspa: "MSc Computing",
    uwtsd: "MBA Cyber Security", koi: "Graduate Diploma of IT", victoria: "MBA", anglia: "MSc Information Systems", diu: "MBA",
  };
  let ci = 0;
  for (const [code, uni, name] of courses) {
    await refEntity(`c:${code}`, "course", code, `u:${uni}`, { name, program: PROGRAM[uni] ?? "Postgraduate", referencing: REFS[ci % REFS.length] });
    courseName.set(code, name);
    ci++;
  }
  for (const s of ["APA 7th", "IEEE", "Harvard"]) await refEntity(`rs:${s}`, "referencing_style", s);
  // A couple of university cover-sheet templates (metadata only; no file) so the
  // Academic grid's Cover-sheet column is populated for the demo.
  for (const [uniKey, nm] of [["uwe", "UWE Bristol — Coursework Cover"], ["koi", "KOI Assignment Cover Sheet"]] as const) {
    await q(`insert into cover_sheet_template (id, org_id, name, university_ref_id) values ($1,$2,$3,$4)`,
      [randomUUID(), DEMO_ORG, nm, refId.get(`u:${uniKey}`)]);
  }

  // ─── Parties ──────────────────────────────────────────────────────────────────
  const P = new Map<string, string>();
  const party = async (key: string, name: string, types: string[], opts?: { ref?: string; uni?: string; programme?: string }) => {
    const id = randomUUID();
    P.set(key, id);
    await q(`insert into party (id, org_id, display_name, party_type, external_ref, university_id, programme) values ($1,$2,$3,$4::text[],$5,$6,$7)`,
      [id, DEMO_ORG, name, types, opts?.ref ?? null, opts?.uni ? refId.get(opts.uni) : null, opts?.programme ?? null]);
    return id;
  };
  await party("momin", "Momin (demo)", ["partner", "writer"]);
  await party("emon", "Emon (demo)", ["partner", "writer"]);
  const clients: Array<[string, string, string, string, string]> = [ // key, name, uniKey, studentId, programme
    ["mujahid", "Mujahid", "uwe", "UWE-1001", "BBA"], ["nadim", "Nadim", "bathspa", "BS-2002", "MSc Computing"],
    ["mezbahul", "Mezbahul Arefin", "coventry", "COV-3003", "CS"], ["mujibur", "Md Mujibur Rahman", "diu", "DIU-4004", "MBA"],
    ["rajesh", "Rajesh", "uwtsd", "UWTSD-5005", "Cyber Security"], ["rahim", "Rahim Ahmed", "koi", "KOI-6006", "ICT"],
    ["karim", "Karim Uddin", "londonmet", "LM-7007", "IT"], ["aditta", "Aditta", "londonmet", "LM-7008", "IT"],
    ["abir", "Abir Ulster", "coventry", "COV-3009", "BBA"], ["emad", "Emad", "victoria", "VU-8010", "MBA"],
  ];
  // Universities are keyed `u:<k>` in refId — pass the prefixed key so the client's
  // university_id actually links (was silently null: bare key ≠ stored key).
  for (const [k, name, uni, id, prog] of clients) await party(k, name, ["client"], { ref: id, uni: `u:${uni}`, programme: prog });
  const writers = ["Humaira", "Mitul", "Khalid", "Rafsan", "Durjoy", "Fatin", "Fahim", "Ishaan", "Nabila", "Sadia"];
  for (const w of writers) await party(`w:${w}`, w, ["writer"]);
  for (const v of ["Toma Apu", "Imu", "Sohel"]) await party(`v:${v}`, v, ["vendor"]);
  for (const r of ["Lemon", "Antu", "Shohan"]) await party(`r:${r}`, r, ["partner", "referrer"]);
  await party("ch:facebook", "Facebook", ["channel"]);
  await party("ch:web", "Website", ["channel"]);

  // ─── Users (logins: sysadmin, both admins, 2 writers, a vendor, a partner) ──────
  const mominU = randomUUID();
  const user = async (email: string, partyKey: string | null, roles: string[]) => {
    const id = randomUUID();
    await q(`insert into user_account (id, org_id, email, password_hash, status, party_id) values ($1,$2,$3,$4,'active',$5)`,
      [id, DEMO_ORG, email, pw, partyKey ? P.get(partyKey) : null]);
    for (const r of roles) await q(`insert into user_role (org_id, user_id, role_id) values ($1,$2,$3)`, [DEMO_ORG, id, r]);
    return id;
  };
  await user("sysadmin@demo.local", null, [ROLE.sysSuper]);
  await q(`insert into user_account (id, org_id, email, password_hash, status, party_id) values ($1,$2,$3,$4,'active',$5)`,
    [mominU, DEMO_ORG, "momin@demo.local", pw, P.get("momin")]);
  for (const r of [ROLE.admin, ROLE.writer]) await q(`insert into user_role (org_id, user_id, role_id) values ($1,$2,$3)`, [DEMO_ORG, mominU, r]);
  // Stamp "added by" on the demo clients (created_by is set at real create time; the
  // seed backfills it so the Clients directory's admin-only Added-by column shows data).
  await q(`update party set created_by = $1 where org_id = $2 and party_type @> array['client']::text[]`, [mominU, DEMO_ORG]);
  await user("emon@demo.local", "emon", [ROLE.admin, ROLE.writer]);
  await user("humaira@demo.local", "w:Humaira", [ROLE.writer]);
  await user("mitul@demo.local", "w:Mitul", [ROLE.writer]);
  await user("toma@demo.local", "v:Toma Apu", [ROLE.vendor]);
  await user("lemon@demo.local", "r:Lemon", [ROLE.referrer]);

  // ─── Jobs (each carries legs so margin populates) ───────────────────────────────
  const fullJob = async (o: {
    title: string; clientKey: string; doerKey: string; adminKey: "momin" | "emon"; course?: string;
    workState: string; moneyState?: string; lineStatus: string; words?: number; unitLabel?: string;
    clientRate?: number; writerRate?: number; clientAmount: number; writerAmount: number;
    bill?: "none" | "invoiced" | "partial" | "settled"; delivery?: number;
  }) => {
    const jobId = randomUUID();
    const client = P.get(o.clientKey)!, doer = P.get(o.doerKey)!, admin = P.get(o.adminKey)!;
    const courseRef = o.course ? refId.get(`c:${o.course}`) ?? null : null;
    await q(
      `insert into work_item (id,org_id,title,work_state,money_state,source_party_id,client_party_id,doer_party_id,course_ref_id,module_name,delivery_date,word_count,created_by)
       values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12)`,
      [jobId, DEMO_ORG, o.title, o.workState, o.moneyState ?? "unbilled", client, doer, courseRef,
       o.course ? courseName.get(o.course) ?? null : null, o.delivery ? past(o.delivery) : null, o.words ?? null, mominU],
    );
    const consumerLine = randomUUID();
    const billed = o.bill && o.bill !== "none";
    await q(`insert into work_line (id,org_id,work_item_id,line_kind,line_status,consumer_party_id,word_count,unit_count,unit_label,client_rate) values ($1,$2,$3,'part',$4,$5,$6,1,$7,$8)`,
      [consumerLine, DEMO_ORG, jobId, billed ? "billed" : o.lineStatus, client, o.words ?? null, o.unitLabel ?? "words", o.clientRate ?? null]);
    await q(`insert into work_line (id,org_id,work_item_id,line_kind,line_status,writer_party_id,word_count,unit_count,unit_label,writer_rate) values ($1,$2,$3,'part',$4,$5,$6,1,$7,$8)`,
      [randomUUID(), DEMO_ORG, jobId, o.lineStatus, doer, o.words ?? null, o.unitLabel ?? "words", o.writerRate ?? null]);
    // Legs: client → admin (revenue), admin → writer (cost). RLS-derived margin uses these.
    await q(`insert into leg (id,org_id,work_item_id,seq,from_party_id,to_party_id,amount,created_by) values ($1,$2,$3,1,$4,$5,$6,$7)`,
      [randomUUID(), DEMO_ORG, jobId, client, admin, String(o.clientAmount), mominU]);
    await q(`insert into leg (id,org_id,work_item_id,seq,from_party_id,to_party_id,amount,created_by) values ($1,$2,$3,2,$4,$5,$6,$7)`,
      [randomUUID(), DEMO_ORG, jobId, admin, doer, String(o.writerAmount), mominU]);
    // Invoice / payment.
    if (billed) {
      const invId = randomUUID(), invLine = randomUUID();
      const status = o.bill === "settled" ? "paid" : o.bill === "partial" ? "partial" : "open";
      await q(`insert into invoice (id,org_id,client_party_id,status,created_by) values ($1,$2,$3,$4,$5)`, [invId, DEMO_ORG, client, status, mominU]);
      await q(`insert into invoice_line (id,org_id,invoice_id,work_line_id,amount) values ($1,$2,$3,$4,$5)`, [invLine, DEMO_ORG, invId, consumerLine, String(o.clientAmount)]);
      if (o.bill === "settled" || o.bill === "partial") {
        const pay = o.bill === "settled" ? o.clientAmount : Math.round(o.clientAmount * 0.5);
        const payId = randomUUID();
        await q(`insert into payment (id,org_id,direction,counterparty_party_id,amount,paid_at,medium,created_by) values ($1,$2,'in',$3,$4,$5,'bank',$6)`,
          [payId, DEMO_ORG, client, String(pay), past((o.delivery ?? 10)), mominU]);
        await q(`insert into payment_allocation (id,org_id,payment_id,invoice_line_id,amount) values ($1,$2,$3,$4,$5)`, [randomUUID(), DEMO_ORG, payId, invLine, String(pay)]);
      }
    }
    return jobId;
  };

  const firstJob = await fullJob({ title: "Customer Needs & UX — Report", clientKey: "mujahid", doerKey: "w:Mitul", adminKey: "momin", course: "UMKCQT", workState: "delivered", moneyState: "settled", lineStatus: "submitted", words: 4500, clientRate: 2, clientAmount: 9000, writerAmount: 5000, bill: "settled", delivery: 20 });
  await fullJob({ title: "People & Organisations — Report", clientKey: "mujahid", doerKey: "w:Mitul", adminKey: "momin", course: "UMOCQW", workState: "delivered", moneyState: "settled", lineStatus: "submitted", words: 2500, clientRate: 2, clientAmount: 5000, writerAmount: 2800, bill: "settled", delivery: 18 });
  await fullJob({ title: "Managing Finance — Report", clientKey: "mujahid", doerKey: "w:Khalid", adminKey: "momin", course: "UMAD47", workState: "delivered", moneyState: "invoiced", lineStatus: "submitted", words: 2000, clientRate: 2, clientAmount: 4000, writerAmount: 2200, bill: "invoiced", delivery: 12 });
  await fullJob({ title: "AI Concepts — A1 Report & System", clientKey: "nadim", doerKey: "w:Ishaan", adminKey: "momin", course: "COMP7032M", workState: "confirmed", lineStatus: "submitted", words: 10000, unitLabel: "weight%", clientAmount: 36000, writerAmount: 22000, bill: "invoiced", delivery: 6 });
  await fullJob({ title: "Cloud Computing — A1 Report", clientKey: "mezbahul", doerKey: "w:Fatin", adminKey: "momin", course: "COMP7033M", workState: "confirmed", lineStatus: "submitted", words: 8000, clientAmount: 17500, writerAmount: 11000, bill: "partial", delivery: 4 });
  await fullJob({ title: "Research Methods — Proposal", clientKey: "mujibur", doerKey: "w:Rafsan", adminKey: "emon", course: "MBA701", workState: "confirmed", lineStatus: "submitted", words: 3500, clientAmount: 13500, writerAmount: 8000, bill: "invoiced", delivery: 8 });
  await fullJob({ title: "Cyber Security — Assessment 1", clientKey: "rajesh", doerKey: "w:Fahim", adminKey: "emon", course: "CYB701", workState: "pending", lineStatus: "pending", words: 2000, clientAmount: 13447, writerAmount: 8000, bill: "none" });
  await fullJob({ title: "UI/UX — Tutorial 3", clientKey: "karim", doerKey: "w:Humaira", adminKey: "emon", course: "ICT751", workState: "pending", lineStatus: "pending", words: 2, unitLabel: "copies", clientRate: 800, clientAmount: 1600, writerAmount: 900, bill: "none" });
  await fullJob({ title: "Web Development — Assignment 3", clientKey: "aditta", doerKey: "w:Durjoy", adminKey: "emon", course: "ICT726", workState: "confirmed", lineStatus: "submitted", words: 1, unitLabel: "copies", clientRate: 4500, clientAmount: 4500, writerAmount: 2500, bill: "invoiced", delivery: 3 });
  await fullJob({ title: "International Finance — A1", clientKey: "abir", doerKey: "emon", adminKey: "emon", course: "BMG704", workState: "delivered", moneyState: "settled", lineStatus: "submitted", words: 2500, clientRate: 2, clientAmount: 5000, writerAmount: 2500, bill: "settled", delivery: 25 });
  await fullJob({ title: "Business Strategy — Essay", clientKey: "emad", doerKey: "w:Nabila", adminKey: "momin", course: "BUS500", workState: "pending", lineStatus: "draft", words: 1500, clientAmount: 3000, writerAmount: 1800, bill: "none" });
  // A cancelled one + a resit-style loss.
  const cancelledJob = await fullJob({ title: "HR Report (withdrawn)", clientKey: "rahim", doerKey: "w:Sadia", adminKey: "momin", course: "ISYS704", workState: "pending", lineStatus: "cancelled", words: 2000, clientAmount: 0, writerAmount: 0, bill: "none" });

  // ─── Operating costs + writer payouts (so the Cashbook shows both sides) ────────
  const mominP = P.get("momin");
  for (const [cat, amt, note, days] of [
    ["subscription", 4500, "Turnitin — annual", 22], ["subscription", 1200, "Grammarly — team", 12],
    ["promo", 3000, "Facebook ads — July", 8], ["salary", 18000, "Fahim — July salary", 3],
  ] as const) {
    await q(`insert into expense (id, org_id, category, amount, incurred_at, cost_bearer, bearer_party_id, note, created_by) values ($1,$2,$3,$4,$5,'party',$6,$7,$8)`,
      [randomUUID(), DEMO_ORG, cat, String(amt), past(days), mominP, note, mominU]);
  }
  for (const [wKey, amt] of [["w:Mitul", 5000], ["w:Khalid", 2200]] as const) {
    await q(`insert into payment (id, org_id, direction, counterparty_party_id, amount, paid_at, medium, note, created_by) values ($1,$2,'out',$3,$4,$5,'Bank',$6,$7)`,
      [randomUUID(), DEMO_ORG, P.get(wKey), String(amt), past(9), "Writer payout (demo)", mominU]);
  }

  // ─── Channels + opening balances + tasks ───────────────────────────────────────
  for (const chKey of ["ch:facebook", "ch:web"]) {
    await q(`insert into channel (id, org_id, party_id, controller_party_id, medium, is_active, created_by) values ($1,$2,$3,null,$4,true,$5)`,
      [randomUUID(), DEMO_ORG, P.get(chKey), chKey === "ch:facebook" ? "facebook" : "web", mominU]);
  }
  // Effective-dated split terms (the Settings page): a co-admin split, a referral %,
  // and a per-word writer rate. Append-only — a change is a new dated term.
  for (const [fromKey, toKey, type, val, basis] of [
    [null, "emon", "split_pct", 50, null], [null, "r:Lemon", "referral_pct", 10, "revenue"], [null, "w:Humaira", "per_word", 1.2, null],
  ] as const) {
    await q(`insert into deal_term (id, org_id, from_party_id, to_party_id, applies_to, term_type, basis, value, effective_from, created_by) values ($1,$2,$3,$4,'default',$5,$6,$7,$8,$9)`,
      [randomUUID(), DEMO_ORG, fromKey ? P.get(fromKey) : null, P.get(toKey), type, basis, String(val), past(180), mominU]);
  }
  for (const [wKey, amt] of [["w:Humaira", 2000], ["w:Khalid", 1500], ["w:Fatin", -500]] as const) {
    await q(`insert into opening_balance (id, org_id, party_id, amount, currency, as_of, note, created_by) values ($1,$2,$3,$4,'BDT',$5,$6,$7)`,
      [randomUUID(), DEMO_ORG, P.get(wKey), String(amt), past(90), "Carried-over at go-live (demo)", mominU]);
  }
  await q(`insert into task (id, org_id, title, state, work_item_id, assignee_party_id, created_by) values ($1,$2,$3,'open',$4,$5,$6)`,
    [randomUUID(), DEMO_ORG, "Deliver Customer Needs & UX final", firstJob, P.get("w:Mitul"), mominU]);
  await q(`insert into task (id, org_id, title, state, assignee_party_id, created_by) values ($1,$2,$3,'open',$4,$5)`,
    [randomUUID(), DEMO_ORG, "Chase Nadim for the brief", P.get("momin"), mominU]);
  void cancelledJob;

  // ─── Personal Finance plane (private demo account) ──────────────────────────────
  await q(`insert into pf_account (id, email, password_hash, status, display_name, base_currency) values ($1,$2,$3,'active','Demo (PF)','BDT')`, [DEMO_PF_ACCOUNT, "pf-demo@demo.local", pw]);
  const catInc = randomUUID(), catExp = randomUUID(), catInv = randomUUID();
  await q(`insert into pf_category (id, pf_account_id, kind, name) values ($2,$1,'income','Salary'),($3,$1,'expense','Rent'),($4,$1,'investment','Stocks')`, [DEMO_PF_ACCOUNT, catInc, catExp, catInv]);
  for (const [cat, amt, cur, days, note] of [[catInc, 30000, "BDT", 15, "Monthly salary"], [catInc, 8000, "BDT", 5, "Freelance"]] as const) {
    await q(`insert into pf_income (id, pf_account_id, category_id, amount, currency, occurred_on, note) values ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), DEMO_PF_ACCOUNT, cat, String(amt), cur, past(days), note]);
  }
  for (const [amt, days, note] of [[12000, 10, "Flat rent"], [2450, 8, "Claude"], [2300, 6, "ChatGPT"]] as const) {
    await q(`insert into pf_expense (id, pf_account_id, category_id, amount, currency, occurred_on, note) values ($1,$2,$3,$4,'BDT',$5,$6)`, [randomUUID(), DEMO_PF_ACCOUNT, catExp, String(amt), past(days), note]);
  }
  const inv = randomUUID();
  await q(`insert into pf_investment (id, pf_account_id, category_id, name, principal, currency, started_on, note) values ($1,$2,$3,$4,$5,'BDT',$6,$7)`, [inv, DEMO_PF_ACCOUNT, catInv, "DSE Stocks", "50000", past(120), "Demo holding"]);
  await q(`insert into pf_investment_event (id, pf_account_id, investment_id, kind, amount, occurred_on, note) values ($1,$2,$3,'valuation',$4,$5,$6)`, [randomUUID(), DEMO_PF_ACCOUNT, inv, "55000", past(5), "Latest mark"]);
}
