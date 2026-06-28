-- ============================================================================
-- 0017_outcomes.sql — Module 7: per-work outcomes + writer capacity (§8).
--  - work_outcome (SCHEMA §G): one recorded outcome per finished work_item.
--    Entered by an authorized role (outcomes module), NEVER self-reported by the
--    writer (enforced in the service). Reputation is a DERIVED read-model over
--    these rows — never a stored score.
--  - party.availability / max_concurrent: the capacity surface (load is derived
--    from open work_items; course history is derived from logged jobs).
--  - Seeds the new 'outcomes' permission module.
-- Mutable operational data (corrections are edits, audited) — NOT append-only,
-- but no DELETE (an outcome shouldn't vanish). Tenant-RLS like the spine.
-- ============================================================================

create table work_outcome (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  work_item_id uuid not null references work_item(id),
  on_time boolean,
  days_late int,
  revision_count int not null default 0,
  revision_fault text,                       -- writer | brief_change | client
  grade text,
  marker_feedback text,
  complaint boolean not null default false,
  complaint_reason text,
  failed boolean not null default false,
  ai_score numeric(5,2),
  satisfaction text,                         -- high | neutral | low
  rework_cost numeric(14,2),
  disputed boolean not null default false,
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- One outcome per finished work item.
create unique index work_outcome_work_item_uidx on work_outcome (work_item_id);
create index work_outcome_org_idx on work_outcome (org_id);

alter table work_outcome enable row level security;
alter table work_outcome force row level security;
create policy tenant_isolation on work_outcome for all
  using (org_id = app_current_org()) with check (org_id = app_current_org());

-- Mutable (edit to correct) but never deletable.
grant select, insert, update on work_outcome to app_user;

-- ─── Writer capacity surface on party (load is derived; these are set) ───────
alter table party
  add column if not exists availability text not null default 'available', -- available|limited|unavailable
  add column if not exists max_concurrent int;

-- ─── Seed the 'outcomes' permission module ───────────────────────────────────
-- System SuperAdmin: all actions.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'outcomes', a
from unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- Business SuperAdmin: view.
insert into permission (org_id, role_id, module, action) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'outcomes', 'view')
on conflict do nothing;

-- Admin (Momin/Emon): all actions.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', 'outcomes', a
from unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- QA: the delegated "admin-assigned role" that records outcomes (not full admin).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a7', 'outcomes', a
from unnest(array['view','create','edit']) a
on conflict do nothing;

-- Writer: view only (their own — enforced in the service).
insert into permission (org_id, role_id, module, action) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a6', 'outcomes', 'view')
on conflict do nothing;
