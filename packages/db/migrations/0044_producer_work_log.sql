-- ============================================================================
-- 0044_producer_work_log.sql — HRM/employee work-logging surface (BUSINESS_MODEL
-- AUDIT item 12). The data model already absorbs most of HRM (employee party
-- type; comp_rule monthly/weekly/contractual + nullable rate + role targeting;
-- salary expense category; cost_bearer→party ref from 0036 already routes an
-- attributed salary into the owning partner's derived balance). The two missing
-- SURFACES: (1) an employee logs work with NO price visible, (2) salary-owner
-- attribution — which is ALREADY recordable via the expenses form (category
-- 'salary' + cost_bearer 'party' + bearer_party_id). This migration adds (1).
--
-- producer_work_log is a capture-first, propose→confirm record (CLAUDE.md rule 8):
-- an employee logs work (no money column exists on this table, so the surface can
-- never show a price); an admin CONVERTS a log into a priced producer work_line
-- (via the existing line service) or rejects it. Operational state: tenant-RLS,
-- select/insert/update; employee-own scoping is server-side (like task/vendor).
-- ============================================================================

create table if not exists producer_work_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  employee_party_id uuid not null references party(id),
  work_item_id uuid references work_item(id),        -- the job it's for (optional at log time)
  title text not null,
  description text,
  quantity numeric(12,2),                            -- hours / units (no rate — never priced here)
  logged_on date not null,
  status text not null default 'draft' check (status in ('draft', 'converted', 'rejected')),
  converted_work_line_id uuid references work_line(id),
  created_by uuid references user_account(id),
  created_at timestamptz not null default now()
);
create index if not exists producer_work_log_org_idx on producer_work_log (org_id, status);
create index if not exists producer_work_log_employee_idx on producer_work_log (org_id, employee_party_id);

alter table producer_work_log enable row level security;
alter table producer_work_log force row level security;
create policy tenant_isolation on producer_work_log for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
grant select, insert, update on producer_work_log to app_user;

-- ─── Employee role + permissions (module 'hrm') ───────────────────────────────
-- The Employee role logs work (hrm:view/create) but sees NO money; admins/
-- superadmins review + convert (hrm:approve). Roles are data (rule 9).
insert into role (id, org_id, name, is_system)
values ('00000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-000000000001', 'Employee', true)
on conflict (id) do nothing;

insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'hrm', a
from unnest(array['view','create']) a
on conflict do nothing;

insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r, 'hrm', a
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3'
]::uuid[]) r
cross join unnest(array['view','approve']) a
on conflict do nothing;
