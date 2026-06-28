-- ============================================================================
-- 0023_custom_fields.sql — Custom fields (DESIGN_SPEC §2 #10, §8).
-- Admin-defined, typed, scoped structured fields — "the governed version of
-- 'add any column'" — that appear on records and are searchable. The GOVERNED
-- counterpart to free-form notes (which stay in `notes`/`details`, untouched).
--   custom_field_def  — the catalog (SCHEMA §G), admin-defined.
--   <entity>.custom_json — where VALUES live, keyed by the def's id (rename-proof).
-- Values are validated against the catalog at the API boundary (type/options/
-- applicability hard; required soft-at-draft, hard at a governance gate).
-- ============================================================================

-- custom_field_def: SCHEMA §G + the standing provenance/standards (required,
-- sort, active-via-archived_at, created/updated provenance).
create table custom_field_def (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  target_entity text not null,          -- work_item | party | project
  field_name text not null,             -- display name (e.g. "WhatsApp Reference")
  field_type text not null,             -- text | number | date | select | bool
  options_json jsonb,                   -- select only: the dropdown options (string[])
  scope_json jsonb not null default '{}', -- global ({}) or attrs to match (client/uni/type)
  required boolean not null default false,
  sort int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  archived_at timestamptz               -- archive (not delete) to preserve stored values
);
create index custom_field_def_target_idx on custom_field_def (org_id, target_entity);

alter table custom_field_def enable row level security;
alter table custom_field_def force row level security;
create policy tenant_isolation on custom_field_def for all
  using (org_id = app_current_org()) with check (org_id = app_current_org());

-- Mutable (rename/options/required/scope/active) but never deletable — archive.
grant select, insert, update on custom_field_def to app_user;

-- ─── custom_json on the targeted records (work_item already has it, 0000) ─────
alter table party   add column if not exists custom_json jsonb default '{}';
alter table project add column if not exists custom_json jsonb default '{}';

-- ─── Seed the 'custom_fields' permission module ──────────────────────────────
-- System SuperAdmin (a1) + Admin (a3): all actions (DEFINE fields = governed).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'custom_fields', a
from unnest(array['00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a3']) r
cross join unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- Business SuperAdmin (a2): view.
insert into permission (org_id, role_id, module, action) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'custom_fields', 'view')
on conflict do nothing;

-- Operational roles (a4 Manager, a5 Coordinator, a6 Writer, a7 QA): view — so
-- they can render the fields, fill values on records, and search to verify.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'custom_fields', 'view'
from unnest(array[
  '00000000-0000-4000-8000-0000000000a4','00000000-0000-4000-8000-0000000000a5',
  '00000000-0000-4000-8000-0000000000a6','00000000-0000-4000-8000-0000000000a7'
]) r
on conflict do nothing;
