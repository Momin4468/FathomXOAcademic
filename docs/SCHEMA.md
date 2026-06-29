# SCHEMA.md — Business OS data model

> **Status:** v0.1 — the *load-bearing* tables (the spine) defined precisely; later-phase tables outlined for the agent to extend. **Do not redesign the spine.** Implement it; extend the outlined parts following the same conventions. Every decision here traces to `DESIGN_SPEC.md` (section refs in parentheses).

## Conventions (apply to every table)

- **`org_id uuid not null`** on every table → references `org(id)`. Every query scoped by it. (Spec §11)
- Primary keys: `id uuid default gen_random_uuid()`.
- Provenance on every table: `created_by`, `created_at`, `updated_by`, `updated_at`. Money/claim tables also: `confirmed_by`, `confirmed_at`.
- **Money is append-only.** Ledger/payment rows are never updated or deleted; corrections are reversing entries.
- **Effective-dated** rule tables carry `effective_from`, `effective_to (nullable)`.
- Soft-delete via `archived_at` where deletion is conceptually needed; never hard-delete money or audit rows.
- Postgres **row-level security** policies enforce visibility (§4); the column comments below mark who may read sensitive columns.
- `jsonb` used for custom-field values and flexible metadata.

---

## A. Tenancy, identity, access

**`org`** — a tenant (the business; later, each customer). Single-tenant today, but the column exists everywhere.

**`user_account`** — a login. Auth only. Created manually for admins; everyone else invited/registered, sets own password, optional 2FA. *Distinct from `party`.*

**`party`** — any actor: client, writer, vendor, referrer, partner, employee. A `user_account` may link to a `party` (some parties — e.g. clients — have no login). `party_type` is a tag, not a role.

**`role`** — roles as data (§4.3). Not an enum.
**`permission`** — `role_id × module × action(view/create/edit/approve) × scope_json` (rows: which writers/clients; fields: which columns). The visibility engine reads these + leg-membership.
**`user_role`** — a user's roles (multi-hat; may be scoped). A person is many roles by context.

```sql
create table org (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table user_account (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  email citext unique not null,
  password_hash text not null,
  twofa_secret text,                 -- nullable; required for money/vault roles. ENCRYPTED AT REST (0025): an `enc:` AES-GCM sealed value (legacy plaintext is read + lazily re-sealed). No schema change.
  status text not null default 'active',  -- active | invited | deactivated
  party_id uuid references party(id), -- nullable: link, not merge
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table party (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  display_name text not null,
  party_type text[] not null default '{}',  -- {client,writer,vendor,referrer,partner,employee}
  external_ref text,                 -- student id etc. (for clients)
  university_id uuid references ref_entity(id),
  programme text,
  contact_json jsonb default '{}',
  expertise_tags text[] default '{}',
  notes text,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table role (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  name text not null,
  is_system boolean not null default false  -- seeded defaults vs admin-created
);

create table permission (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  role_id uuid not null references role(id),
  module text not null,
  action text not null,              -- view|create|edit|approve
  scope_json jsonb not null default '{}'  -- row + field scoping
);

create table user_role (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  user_id uuid not null references user_account(id),
  role_id uuid not null references role(id),
  scope_json jsonb default '{}'      -- e.g. {"writers":[...]} for a manager
);
```

---

## B. Reference data (canonical, with aliases) (§7)

**`ref_entity`** — canonical university / course / assignment-type / referencing-style. Fuzzy-in, canonical-out.
**`ref_alias`** — every spelling that resolves to a canonical (`ICT 701`, `ICT701`, `701`). `normalized` = lowercased, punctuation/space-stripped, for matching.
New entries are `status='provisional'` until a data-steward `confirmed`/merged.

```sql
create table ref_entity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  kind text not null,                -- university | course | assignment_type | referencing_style
  canonical text not null,
  parent_id uuid references ref_entity(id),  -- course belongs to university, etc.
  meta_json jsonb default '{}',      -- e.g. referencing style per programme
  status text not null default 'provisional', -- provisional | confirmed
  confirmed_by uuid, confirmed_at timestamptz,
  created_by uuid, created_at timestamptz not null default now()
);

create table ref_alias (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  ref_id uuid not null references ref_entity(id),
  alias text not null,
  normalized text not null           -- index this for search
);
create index on ref_alias (org_id, normalized);
```

---

## C. Work: items, lines, projects (§3.2–3.3, §5)

**`project`** — engagement container (thesis / course). Optional; a plain job has none. Holds milestones; child work items flagged trackable/billable/both.
**`milestone`** — project milestone (from template or ad-hoc); has due date + tz.
**`milestone_template`** / **`milestone_template_item`** — per-uni/programme templates (UWTSD MBA Thesis → proposal→ethics→…), instantiated then extended.
**`work_item`** — the job. Producer-side anchor. Belongs to optional project. Has work-state. Carries source party (who sourced it → drives the leg chain).
**`work_line`** — component of a work item: a copy, a rate-layer, an extra-work add-on, or a multi-writer part. **Consumer-side party + price live here.** Single-assignment = one line.

```sql
create table project (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  title text not null,
  client_party_id uuid references party(id),
  template_id uuid references milestone_template(id),
  estimate_amount numeric(14,2),     -- provisional; superseded at final (§5)
  status text not null default 'active',
  created_by uuid, created_at timestamptz not null default now()
);

create table milestone (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  project_id uuid not null references project(id),
  title text not null,
  trackable boolean not null default true,
  billable boolean not null default false,
  due_at timestamptz,                -- absolute moment
  due_tz text,                       -- e.g. 'Australia/Sydney'
  state text not null default 'pending',
  sort int default 0
);

create table work_item (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  project_id uuid references project(id),       -- null for standalone jobs
  milestone_id uuid references milestone(id),    -- null unless tied to a milestone
  course_ref_id uuid references ref_entity(id),
  assignment_type_ref_id uuid references ref_entity(id),
  title text not null,
  details text,
  source_party_id uuid references party(id),     -- who sourced it (top of leg chain)
  doer_party_id uuid references party(id),        -- assigned writer (producer)
  assigner_user_id uuid references user_account(id),
  work_state text not null default 'draft',      -- draft|pending|confirmed|delivered
  money_state text not null default 'unbilled',  -- unbilled|invoiced|partial|settled (derived/maintained)
  is_estimate boolean not null default false,
  custom_json jsonb default '{}',                -- admin-defined custom fields
  brief_file_id uuid references file_object(id),
  notes text,
  created_by uuid, created_at timestamptz not null default now(),
  confirmed_by uuid, confirmed_at timestamptz,   -- governance: claim until confirmed
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table work_line (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  work_item_id uuid not null references work_item(id),
  line_kind text not null,           -- copy | rate_layer | extra | part
  consumer_party_id uuid references party(id),   -- the client for this copy (consumer side)
  writer_party_id uuid references party(id),     -- for multi-writer parts (producer side)
  word_count int,
  unit_count int default 1,          -- copies
  client_rate numeric(10,4),         -- CONSUMER side; visible per §4
  writer_rate numeric(10,4),         -- PRODUCER side
  fixed_amount numeric(14,2),        -- when not rate×count (e.g. presentation 2000)
  note text
);
-- NOTE: line client/writer *amounts* are computed (rate×count or fixed); do NOT store profit.
```

---

## D. The money chain: legs (§3.1) — the heart of the opacity model

**`leg`** — one link in a work item's money chain: `from_party → to_party`, an amount, and the two parties who may see it. Margin at a node = inbound − outbound, computed, never stored. SuperAdmin sees all legs; everyone else sees only legs they are `from`/`to` on (enforced by RLS).

```sql
create table leg (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  work_item_id uuid not null references work_item(id),
  work_line_id uuid references work_line(id),    -- nullable: item-level or line-level leg
  seq int not null,                  -- order in the chain (1=client→top, ... ,n=→writer)
  from_party_id uuid references party(id),
  to_party_id uuid references party(id),
  amount numeric(14,2) not null,
  deal_term_id uuid references deal_term(id),    -- which rule produced this leg
  note text,
  created_by uuid, created_at timestamptz not null default now()
);
-- RLS policy: a user may SELECT a leg only if SuperAdmin OR their party_id in (from_party_id,to_party_id).
```

---

## E. Rules: deal terms & comp rules (§3.4–3.5) — effective-dated

**`deal_term`** — rule on a relationship (from→to party, or party↔job-type): split %, commission %, referral %, per-word, or fixed. Precedence: most-specific → default. Date-versioned.
**`comp_rule`** — how a party/role is paid: basis + rate + **cost-bearer** + cadence. Salary, per-word, per-file, commission all live here.

```sql
create table deal_term (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  from_party_id uuid references party(id),
  to_party_id uuid references party(id),
  applies_to text not null default 'default',  -- default | client:<id> | jobtype:<x>
  term_type text not null,           -- split_pct | commission_pct | referral_pct | per_word | fixed
  basis text,                        -- referral_pct only (0021): revenue | margin | fixed; null otherwise
  value numeric(12,4) not null,      -- pct for revenue/margin; the amount for fixed
  effective_from date not null,
  effective_to date,
  created_by uuid, created_at timestamptz not null default now()
);

create table comp_rule (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  party_id uuid references party(id),  -- or role-level (nullable + role_id)
  role_id uuid references role(id),
  basis text not null,               -- per_word | per_task | per_file | per_copy | commission | monthly | weekly | contractual
  rate numeric(12,4),
  cost_bearer text not null,         -- momin | emon | split | writer  (extensible party ref)
  cost_bearer_split_json jsonb,      -- when 'split'
  cadence text,
  effective_from date not null,
  effective_to date
);
```

---

## F. Invoices & payments (§6) — open-item, append-only

**`invoice`** — a live grouping of billable lines for a client; lifecycle status; can be provisional(estimate)/final; lines can move between invoices.
**`invoice_line`** — a billable `work_line` placed on an invoice (its own record, so a job can be re-billed / moved). Client per-job tracking.
**`payment`** — a money event (in/out): amount, date, direction, medium, trx id, counterparty. Append-only.
**`payment_allocation`** — links a payment to one or more invoice_lines (or to a writer aggregate). Supports partial-within-job and bulk-across-jobs.
**`payment_proof`** — 0..n attachments per payment, each tagged side (payer/payee) + who attached. (Small image files.)

```sql
create table invoice (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  client_party_id uuid not null references party(id),
  status text not null default 'open',  -- open | sent | partial | paid | void
  is_estimate boolean not null default false,
  supersedes_invoice_id uuid references invoice(id),  -- final supersedes estimate
  issued_at date,
  created_by uuid, created_at timestamptz not null default now()
);

create table invoice_line (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  invoice_id uuid not null references invoice(id),
  work_line_id uuid not null references work_line(id),
  amount numeric(14,2) not null,     -- client amount for this line at bill time
  paid_amount numeric(14,2) not null default 0,  -- maintained via allocations
  note text
);

create table payment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  direction text not null,           -- in (from client) | out (to writer/vendor)
  counterparty_party_id uuid references party(id),
  amount numeric(14,2) not null,
  paid_at date not null,
  medium text,                       -- DBBL | Bank | bkash | Nagad | Sonali | cash
  trx_id text,
  note text,
  created_by uuid, created_at timestamptz not null default now()
);  -- append-only

create table payment_allocation (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  payment_id uuid not null references payment(id),
  invoice_line_id uuid references invoice_line(id),  -- client side (per-job)
  writer_party_id uuid references party(id),          -- writer side (aggregate)
  amount numeric(14,2) not null
);

create table payment_proof (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  payment_id uuid not null references payment(id),
  file_object_id uuid not null references file_object(id),
  side text not null,                -- payer | payee
  attached_by uuid not null,
  attached_at timestamptz not null default now()
);
```

---

## G. Cross-cutting

**`expense`** — any cost with a **cost-bearer** (§3.5, §8): subscriptions, salaries, promo (campaign tag + optional revenue link), losses, events. Salary is an expense flavor.
**`custom_field_def`** — admin-defined field: name, type, target entity, scope (global or by type/uni/client), dropdown options. Values stored in target's `custom_json`.
**`file_object`** — small-file storage metadata (briefs, solutions, proofs): key/url, size, kind. Large files = `is_link=true` with url only. DB stores metadata, not blobs.
**`audit_log`** — immutable: actor, action, entity, before/after (or hash), timestamp. Append-only; even System SuperAdmin cannot erase.
**`work_outcome`** — per finished work (§8): on_time, days_late, revision_count, revision_fault, grade, marker_feedback, complaint, fail, ai_score, satisfaction, rework_cost, disputed, resit. Reputation is a **derived read-model** over this — not a stored score.

```sql
create table expense (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  category text not null,            -- subscription | salary | promo | loss | event | other
  -- subscription (0026): next_due_date date, currency text (BDT|USD|GBP|EUR|AUD, recorded no FX), last_reminded_due date (3-day reminder idempotency)
  amount numeric(14,2) not null,
  incurred_at date not null,
  cost_bearer text not null,         -- momin | emon | split | writer
  cost_bearer_split_json jsonb,
  payee_party_id uuid references party(id),
  campaign_tag text,
  revenue_link_id uuid,              -- optional attributable income
  receipt_file_id uuid references file_object(id),
  note text,
  created_by uuid, created_at timestamptz not null default now()
);

create table custom_field_def (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  target_entity text not null,       -- work_item | party | project
  field_name text not null,
  field_type text not null,          -- text|number|date|select|bool
  options_json jsonb,                 -- select only: dropdown options (string[])
  scope_json jsonb not null default '{}', -- global ({}), or by client/uni/type
  required boolean not null default false,   -- 0023
  sort int not null default 0,               -- 0023
  created_by uuid, created_at timestamptz not null default now(),  -- 0023
  updated_by uuid, updated_at timestamptz not null default now(),  -- 0023
  archived_at timestamptz            -- archive (not delete) to keep stored values; 0023
);
-- Values live in the target's custom_json (work_item/party/project all carry it),
-- keyed by the def id. Validated against this catalog at the API boundary (0023).

-- Reminders (0026): reminder_org_ids() (org ids only) lets the daily reminder cron enumerate tenants and run per-org under RLS; expense gains next_due_date/currency/last_reminded_due. EmailService is app-layer (swappable), not a DB object.
-- Hardening (0025): file_owner_context() resolves a file's owner (brief/proof/receipt) for the kind-aware download ACL; settlement_legs() now nets from=null business costs (referral) out of the pool before the partner split. No table changes.
-- Role-scoped dashboards (0024, §8/§10): NO new tables. Two aggregate-only
-- SECURITY DEFINER read-models — dashboard_writer_pnl() (profit-per-writer =
-- client-leg − writer-leg by doer; column `net`, derived) and
-- dashboard_client_dues() (per-client invoiced − paid) — org-scoped, returning
-- rollups only (never raw legs). Plus the `dashboard` permission module
-- (view → all roles; approve → owners + both SuperAdmins, the owner-analytics gate).

create table file_object (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  kind text not null,                -- brief | solution | proof | receipt | other
  is_link boolean not null default false,
  url text,                          -- link, or storage key
  filename text, size_bytes bigint, mime text,
  created_by uuid, created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  actor_user_id uuid,
  action text not null,
  entity text not null, entity_id uuid,
  detail_json jsonb,
  at timestamptz not null default now()
);  -- append-only; no update/delete grants

create table work_outcome (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  work_item_id uuid not null references work_item(id),
  on_time boolean, days_late int,
  revision_count int default 0, revision_fault text,  -- writer | brief_change | client
  grade text, marker_feedback text,
  complaint boolean default false, complaint_reason text,
  failed boolean default false, ai_score numeric(5,2),
  satisfaction text, rework_cost numeric(14,2), disputed boolean default false,
  resit boolean not null default false,  -- a resit (redo) was performed (0022)
  recorded_by uuid, recorded_at timestamptz not null default now()
);
```

---

## H. Outlined for later phases (agent to design following the conventions above)

- **`group_cohort`** + membership — named set of parties (the Mujib 16-cohort) for shared-work views (§7).
- **`credential_vault_item`** + **`credential_share`** — encrypted tool accounts (AcademyCX ×5) with per-party item-level sharing (§8). Secrets-manager pattern; never plaintext.
- **`knowledge_article`** — docs / prompt packs / blogs / video *links* (§8).
- **`service_sale`** — AI/plagiarism check sales (units sold/paid/checked) + credit-consumption against vault accounts (§8).
- **`clock_pref`** — per-user timezones for the world-clock/urgency display (§8).
- **`settlement`** / **`partner_transfer`** — Emon↔Momin running balance + dated transfers (derived from legs + transfers) (§4.4).
- **Personal Finance service** — ✅ BUILT (migration 0027, module 14 `personal_finance`). See **§PF** below.
- **Phase 4 (productize):** tenant provisioning, per-module licensing/entitlement, subscription billing.

## PF. Personal Finance plane (BUILT · migration 0027, §11)

A SEPARATE, independently-sellable service sharing this DB but designed as its own plane (physical split later = a swap). **Its own identity** (`pf_account`, separate credentials), **its own data** (`pf_*`), joined to the business by ONE seam: a one-way income bridge.

- **Tenancy axis = `pf_account_id`** (the PF analogue of `org_id`; PF tables carry NO `org_id` — a standalone user has no org). New GUC `app.pf_account_id` + accessor `app_current_pf_account()`. The app access layer is `DbService.withPfAccount` (sets only the pf GUC, blanks the business GUCs).
- **RLS:** every `pf_*` table is `enable+force` RLS with `pf_account_isolation using (pf_account_id = app_current_pf_account())`. `pf_account` is keyed on `id`. **These policies deliberately do NOT honor `app_is_superadmin`** — the business (SuperAdmin included) sets no `app.pf_account_id` and reads ZERO pf rows. That is the structural privacy guarantee.
- **Tables:** `pf_account` (email/password_hash/twofa_secret/status/base_currency/`linked_party_id` soft link, unique where not null) · `pf_refresh_token` (rotating) · `pf_category` (user-defined income|expense) · `pf_income` / `pf_expense` (amount + currency recorded no-FX + optional converted_amount; append-only `reverses_id`; `pf_income` also source/source_ref/source_party_id, unique `(pf_account_id, source_ref)`) · `pf_loan` + `pf_loan_event` (outstanding DERIVED) · `pf_saving` + `pf_saving_event` (balance DERIVED) · `pf_target` (budget_cap|income_goal|savings_target; progress DERIVED at read) · `pf_subscription` (next_due_date/last_reminded_due; 3-days-before email via the shared EmailService) · `pf_audit_log` (pf-account-scoped) · `pf_link_token` (RLS on, no policy/grant — definer-only).
- **SECURITY DEFINER functions (the sanctioned bypasses):** `pf_auth_lookup` (login), `pf_register` (self-service + seeds default categories), `pf_push_income` (the one-way bridge write — returns void, idempotent on source_ref), `pf_mint_link_token` (business mints for its own party, org-checked), `pf_consume_link_token` (PF consumes: sets linked_party_id + backfills past payouts), `pf_reminder_account_ids` (ids-only cron enumerator).
- **Income bridge:** `payment.service.allocate()`/`reverse()` (direction `out` + writer party) call `IncomeBridgePort` → `pf_push_income` in the business tx; never reads PF back; reversal = negative mirror (nets to zero). Append-only + derived-not-stored preserved; `guard:no-stored-profit` passes.
- New shared enums: `PF_CATEGORY_KINDS`, `PF_INCOME_SOURCES`, `PF_LOAN_DIRECTIONS`, `PF_LOAN_EVENT_KINDS`, `PF_SAVING_EVENT_KINDS`, `PF_TARGET_KINDS`, `PF_TARGET_PERIODS` (+ `PfPrincipal`/`PfRlsContext` types, `GUC.pfAccountId`).
- **Personal notes (migration 0028, in this plane):** `pf_note` (`title`, `body`, `items` jsonb checklist `[{text,done}]`, `color`, `pinned`, `remind_on` + `last_reminded_on`, `archived_at`) + `pf_note_attachment` (`is_link`, `url` = storage key or external URL, `filename`/`size_bytes`/`mime`). Same `pf_account_isolation` RLS. **Editable scratch data, not a ledger** → `update` granted, no append-only/reverse. Attachments follow the file rule via the reused `StorageService` (small→stored, large→link, metadata-only); link-only attachments are never relayed. An optional `remind_on` fires an email on the day (daily `@Cron`, reuses EmailService, idempotent via `last_reminded_on`). New enum `NOTE_COLORS`.

## ANALYTICS. BI plane (BUILT · migration 0029, §8)

Embedded Metabase reads ONLY a redacted `analytics` schema of AGGREGATE views via
a deny-by-default role — never base tables — so opacity (§4.4/§4.5) holds through BI.

- **Role `analytics_ro`** (created by `ensureAppRole`; `login nosuperuser`): granted `usage on schema analytics` + `select on all tables in schema analytics` (+ default privileges) and **nothing else** — no base-table SELECT, no EXECUTE on the GUC-scoped definers (`revoke all on all tables/sequences in schema public`). Metabase connects as this role (dev: same DB; prod: a read replica, same role/schema).
- **Views are superuser-owned** (migration runs as the admin superuser) so they read across FORCE RLS; the **view SQL + the locked Metabase embed param** are the redaction boundary (the views carry `org_id`/`party_id` columns but no built-in filter — the signed embed locks them).
- **Money is org-level only** (per-party money would leak a partner's private price under RLS-bypass). Views: `org_net` (org revenue/writer_cost/net), `org_receivables` (org invoiced/paid/due), `writer_cost` (per-writer jobs + pay, NO revenue/net), `settlement_position` (per partner-pair **shared** pool + transfers — never a private split/client leg), `work_volume` (per-party job counts), `writer_reputation` (per-writer quality aggregates), `expense_totals` (per month/category/bearer), `party_balance` (a party's own earnings/dues/net — member dashboard, locked to `party_id`). No raw-leg / per-client-price / margin-by-source-partner / `pf_*` view exists. Derived money columns are `net` (never `profit`/`margin`).
- **Embed:** `GET /analytics/embed` (module `dashboard`, gated `dashboard:view`) mints a Metabase signed-embed JWT (`METABASE_EMBED_SECRET`, distinct from `JWT_SECRET`) locking `org_id` (owner) or `org_id`+`party_id` (member) from the signed principal. See docs/METABASE_SETUP.md.

## AICAP. AI capture assistant (BUILT · migration 0030, §10/§2)

Unstructured input → PROPOSED drafts. The AI proposes; a human Accept is the
governance confirm. Extraction writes ONLY proposals; a domain record is created
only on human Accept, through the existing create service, stamped "added by AI".

- **`ai_capture`** — one submission (kind text|whatsapp|image|voice; input_text or file_object_id; provider/model/status/usage_tokens). **`ai_proposal`** — each candidate (target_type client|job|payment|expense; proposed_json; confidence; status pending|accepted|rejected; created_entity_type/id on accept). **`ai_usage`** — append-only per-user cap ledger. All tenant-RLS (org_id = app_current_org()); ai_capture/ai_proposal select/insert/update, ai_usage select/insert.
- **Provenance marker:** nullable `ai_capture_id` on `party`, `work_item`, `payment`, `expense` (null = manual, set = added by AI). Set only via the create services' optional `opts.aiCaptureId` (not on any DTO → unforgeable on the manual path).
- **Accept** validates proposed_json against the real create DTO + requires the TARGET's create permission (no escalation); money (payment/expense) is created only here, on human Accept. Lifecycle pending→accepted|rejected (no re-accept).
- **Provider** is swappable behind `AI_CAPTURE_PROVIDER` (dev free default | gemini | claude; fetch, no SDK; fail-closed). Per-(user,org,day) cap `AI_CAPTURE_DAILY_CAP`. New enums `AI_CAPTURE_KINDS`/`AI_PROPOSAL_TARGETS`/`AI_PROPOSAL_STATUSES`; module `ai_capture` (15).

## IMEX. Import / Export / Archive (BUILT · migration 0031, module 16)

- **import_batch** / **import_row** — staged upload (entity_type clients|jobs|payments|settlement_opening; status preview|committed; counts) + per-row raw/mapped/status/errors/resolution + created_entity. Preview writes only these (no domain row); commit creates via the existing services. **archive_item** — dated, tagged, searchable business-file store (title/description/doc_date/tags + file_object_id) reusing the file pipeline; read-only content.
- **Provenance marker:** `import_batch_id` (nullable FK) on `party`, `work_item`, `payment`, `expense`, `settlement_transfer` (set only via the create services' `opts.importBatchId` — unforgeable on the manual path; mirrors `ai_capture_id`).
- **Import** routes through PartyService/WorkService/PaymentService/SettlementService.recordTransfer (validation, RLS, canonical ReferenceService resolution, audit, provenance); partial commit (per-row `withTenant` tx). Commit requires the entity's own create permission. `settlement_opening` → a dated `settlement_transfer` only (2025 = no fabricated jobs).
- **Export** reuses the RLS-scoped, permission-gated list read-models + serializes (CSV native, XLSX via exceljs); each dataset requires its own view permission → never reveals a figure the viewer can't see.
- **Archive** files via FilesService (small stored / large linked, kind `archive`); the file ACL `archive` branch allows read to `import_export:view` holders or the uploader. New enums `IMPORT_ENTITIES`/`IMPORT_ROW_STATUSES`/`EXPORT_DATASETS`; `FILE_KINDS += archive`; module `import_export` (16). Templates + Python preprocessors live in `/import-helpers`.

---

## I. What the agent must NOT do

- Do not add a `profit`/`margin`/`split_amount` column anywhere — always derive from `leg` (§3, §11).
- Do not store money amounts that should be computed (line totals = rate×count or fixed; invoice/writer balances = sums of allocations).
- Do not skip `org_id` or bypass the access layer on any query.
- Do not enforce visibility only in the UI — RLS at the DB is mandatory for legs and money.
- Do not merge `user_account` and `party`, or `user_account` and the Personal-Finance account — they are linked, never merged.
- Do not invent business rules for money/visibility not in the spec — ask, and log the decision.
