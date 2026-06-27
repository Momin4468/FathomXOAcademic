-- ============================================================================
-- 0000_init.sql — Business OS first migration: SCHEMA.md Sections A–F (+ the
-- dependency tables they FK to: ref_entity/ref_alias (B), file_object (G),
-- milestone_template(_item) (H), audit_log (G)).
--
-- Implemented EXACTLY as written in /docs/SCHEMA.md. The only change is CREATE
-- ORDER, to resolve forward references (SCHEMA lists user_account before party,
-- and leg before deal_term; FKs require the inverse). Do not redesign the spine.
--
-- Run as the schema OWNER (the postgres/admin role). RLS + grants for the
-- non-owner app_user role are applied in 0001_rls.sql.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;      -- case-insensitive email

-- ─── A. Tenancy / identity / access ─────────────────────────────────────────

create table org (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ─── B. Reference data (canonical, with aliases) ────────────────────────────
-- Created before party (party.university_id -> ref_entity).

create table ref_entity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  kind text not null,                          -- university | course | assignment_type | referencing_style
  canonical text not null,
  parent_id uuid references ref_entity(id),    -- course belongs to university, etc.
  meta_json jsonb default '{}',
  status text not null default 'provisional',  -- provisional | confirmed
  confirmed_by uuid, confirmed_at timestamptz,
  created_by uuid, created_at timestamptz not null default now()
);

create table ref_alias (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  ref_id uuid not null references ref_entity(id),
  alias text not null,
  normalized text not null                      -- lowercased, punctuation/space-stripped
);
create index ref_alias_org_normalized_idx on ref_alias (org_id, normalized);

-- ─── G. file_object (dependency of work_item.brief_file_id, payment_proof) ───

create table file_object (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  kind text not null,                          -- brief | solution | proof | receipt | other
  is_link boolean not null default false,      -- large files = link only
  url text,                                    -- link, or storage key
  filename text, size_bytes bigint, mime text,
  created_by uuid, created_at timestamptz not null default now()
);

-- party before user_account (user_account.party_id -> party). Link, not merge.

create table party (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  display_name text not null,
  party_type text[] not null default '{}',     -- {client,writer,vendor,referrer,partner,employee}
  external_ref text,                           -- student id etc.
  university_id uuid references ref_entity(id),
  programme text,
  contact_json jsonb default '{}',
  expertise_tags text[] default '{}',
  notes text,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table user_account (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  email citext unique not null,
  password_hash text not null,
  twofa_secret text,                           -- nullable; required for money/vault roles
  status text not null default 'active',       -- active | invited | deactivated
  party_id uuid references party(id),          -- nullable: link, not merge
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table role (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  name text not null,
  is_system boolean not null default false     -- seeded defaults vs admin-created
);

create table permission (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  role_id uuid not null references role(id),
  module text not null,
  action text not null,                        -- view | create | edit | approve
  scope_json jsonb not null default '{}'       -- row + field scoping
);

create table user_role (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  user_id uuid not null references user_account(id),
  role_id uuid not null references role(id),
  scope_json jsonb default '{}'                -- e.g. {"writers":[...]} for a manager
);

-- ─── H. milestone_template (dependency of project.template_id) ───────────────
-- Outlined in SCHEMA §H; minimal definition now, following the conventions.

create table milestone_template (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  name text not null,                          -- e.g. "UWTSD MBA Thesis"
  scope_ref_id uuid references ref_entity(id), -- per-uni/programme (nullable = generic)
  created_by uuid, created_at timestamptz not null default now()
);

create table milestone_template_item (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  template_id uuid not null references milestone_template(id),
  title text not null,
  trackable boolean not null default true,
  billable boolean not null default false,
  sort int default 0
);

-- ─── C. Work: items, lines, projects ────────────────────────────────────────

create table project (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  title text not null,
  client_party_id uuid references party(id),
  template_id uuid references milestone_template(id),
  estimate_amount numeric(14,2),               -- provisional; superseded at final
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
  due_at timestamptz,                          -- absolute moment
  due_tz text,                                 -- e.g. 'Australia/Sydney'
  state text not null default 'pending',
  sort int default 0
);

create table work_item (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  project_id uuid references project(id),         -- null for standalone jobs
  milestone_id uuid references milestone(id),     -- null unless tied to a milestone
  course_ref_id uuid references ref_entity(id),
  assignment_type_ref_id uuid references ref_entity(id),
  title text not null,
  details text,
  source_party_id uuid references party(id),      -- who sourced it (top of leg chain)
  doer_party_id uuid references party(id),         -- assigned writer (producer)
  assigner_user_id uuid references user_account(id),
  work_state text not null default 'draft',       -- draft | pending | confirmed | delivered
  money_state text not null default 'unbilled',   -- unbilled | invoiced | partial | settled
  is_estimate boolean not null default false,
  custom_json jsonb default '{}',                 -- admin-defined custom fields
  brief_file_id uuid references file_object(id),
  notes text,
  created_by uuid, created_at timestamptz not null default now(),
  confirmed_by uuid, confirmed_at timestamptz,    -- governance: claim until confirmed
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table work_line (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  work_item_id uuid not null references work_item(id),
  line_kind text not null,                        -- copy | rate_layer | extra | part
  consumer_party_id uuid references party(id),    -- the client for this copy (consumer side)
  writer_party_id uuid references party(id),      -- for multi-writer parts (producer side)
  word_count int,
  unit_count int default 1,                       -- copies
  client_rate numeric(10,4),                      -- CONSUMER side
  writer_rate numeric(10,4),                      -- PRODUCER side
  fixed_amount numeric(14,2),                     -- when not rate×count (e.g. presentation 2000)
  note text
);
-- NOTE: line client/writer *amounts* are computed (rate×count or fixed); do NOT store profit.

-- ─── E. Rules: deal terms & comp rules (before leg: leg.deal_term_id -> deal_term) ──

create table deal_term (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  from_party_id uuid references party(id),
  to_party_id uuid references party(id),
  applies_to text not null default 'default',     -- default | client:<id> | jobtype:<x>
  term_type text not null,                        -- split_pct | commission_pct | referral_pct | per_word | fixed
  value numeric(12,4) not null,
  effective_from date not null,
  effective_to date,
  created_by uuid, created_at timestamptz not null default now()
);

create table comp_rule (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  party_id uuid references party(id),             -- or role-level (nullable + role_id)
  role_id uuid references role(id),
  basis text not null,                            -- per_word | per_task | per_file | per_copy | commission | monthly | weekly | contractual
  rate numeric(12,4),
  cost_bearer text not null,                      -- momin | emon | split | writer
  cost_bearer_split_json jsonb,                   -- when 'split'
  cadence text,
  effective_from date not null,
  effective_to date
);

-- ─── D. The money chain: legs (the heart of the opacity model) ──────────────

create table leg (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  work_item_id uuid not null references work_item(id),
  work_line_id uuid references work_line(id),      -- nullable: item-level or line-level leg
  seq int not null,                               -- order in the chain (1=client→top, ... ,n=→writer)
  from_party_id uuid references party(id),
  to_party_id uuid references party(id),
  amount numeric(14,2) not null,
  deal_term_id uuid references deal_term(id),      -- which rule produced this leg
  note text,
  created_by uuid, created_at timestamptz not null default now()
);
-- RLS (0001): SELECT a leg only if is_superadmin OR current_party in (from,to). Append-only.

-- ─── F. Invoices & payments (open-item, append-only ledger) ─────────────────

create table invoice (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  client_party_id uuid not null references party(id),
  status text not null default 'open',            -- open | sent | partial | paid | void
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
  amount numeric(14,2) not null,                  -- client amount for this line at bill time
  paid_amount numeric(14,2) not null default 0,   -- maintained via allocations
  note text
);

create table payment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  direction text not null,                        -- in (from client) | out (to writer/vendor)
  counterparty_party_id uuid references party(id),
  amount numeric(14,2) not null,
  paid_at date not null,
  medium text,                                    -- DBBL | Bank | bkash | Nagad | Sonali | cash
  trx_id text,
  note text,
  created_by uuid, created_at timestamptz not null default now()
);  -- append-only

create table payment_allocation (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  payment_id uuid not null references payment(id),
  invoice_line_id uuid references invoice_line(id),  -- client side (per-job)
  writer_party_id uuid references party(id),         -- writer side (aggregate)
  amount numeric(14,2) not null
);  -- append-only

create table payment_proof (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  payment_id uuid not null references payment(id),
  file_object_id uuid not null references file_object(id),
  side text not null,                             -- payer | payee
  attached_by uuid not null,
  attached_at timestamptz not null default now()
);  -- append-only

-- ─── G. audit_log (cross-cutting; immutable; needed by the access layer) ─────

create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  actor_user_id uuid,
  action text not null,
  entity text not null, entity_id uuid,
  detail_json jsonb,
  at timestamptz not null default now()
);  -- append-only; no update/delete grants (see 0001)
