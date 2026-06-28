-- ============================================================================
-- 0020_check_service.sql — Module 10: the AI/plagiarism check service (§8).
-- A semi-separate mini-business: employees collect files from their OWN WhatsApp
-- customers (often not academic clients — a check stands alone), run them through
-- tool accounts (AcademyCX), and collect payment. This replaces the manual
-- WhatsApp tally with a low-friction per-(employee, account, day) BATCH, governed
-- by claim→confirm, and a self-contained P&L (revenue − allocated account cost −
-- worker comp) — all DERIVED at read time; only confirmed batches count.
--   check_channel       — a WhatsApp account/line run by an employee
--   check_tool_account  — a checking tool account (AcademyCX), links the vault login
--   check_credit_topup  — append-only credit purchases (the cost basis)
--   check_batch         — the tally (capture + governance), proposed→confirmed
--   check_file          — optional per-file detail (file + AI/plagiarism score)
-- ============================================================================

create table check_channel (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  label text not null,                         -- e.g. "WA +8801… (Rafi)"
  employee_party_id uuid not null references party(id),
  active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index check_channel_employee_idx on check_channel (employee_party_id);

create table check_tool_account (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  label text not null,                         -- e.g. "AcademyCX #2"
  vault_item_id uuid references credential_vault_item(id), -- the login lives in the vault
  active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Append-only credit purchases → weighted cost-per-credit = Σcost / Σcredits.
create table check_credit_topup (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  tool_account_id uuid not null references check_tool_account(id),
  credits numeric(12,2) not null,              -- negative row = a correction
  cost numeric(14,2) not null,
  purchased_at date not null,
  note text,
  created_by uuid, created_at timestamptz not null default now()
);
create index check_credit_topup_account_idx on check_credit_topup (tool_account_id);

create table check_batch (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  channel_id uuid not null references check_channel(id),
  tool_account_id uuid references check_tool_account(id),
  period_date date not null,
  files_checked int not null default 0 check (files_checked >= 0),
  files_paid int not null default 0 check (files_paid >= 0),
  amount_collected numeric(14,2) not null default 0 check (amount_collected >= 0),
  customer_party_id uuid references party(id),  -- stand-alone (null) or a linked client
  work_item_id uuid references work_item(id),   -- optional job link
  status text not null default 'proposed',      -- proposed | confirmed
  note text,
  recorded_by uuid, recorded_at timestamptz not null default now(),
  confirmed_by uuid, confirmed_at timestamptz,
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index check_batch_period_idx on check_batch (org_id, period_date);
create index check_batch_channel_idx on check_batch (channel_id);
create index check_batch_tool_account_idx on check_batch (tool_account_id);

create table check_file (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  batch_id uuid not null references check_batch(id),
  file_object_id uuid references file_object(id),
  customer_ref text,                            -- e.g. WhatsApp name / number
  ai_score numeric(5,2),
  plagiarism_score numeric(5,2),
  note text,
  created_by uuid, created_at timestamptz not null default now()
);
create index check_file_batch_idx on check_file (batch_id);

-- ── RLS: tenant isolation (reuse the 0001 pattern) ──────────────────────────
do $$
declare t text;
begin
  foreach t in array array['check_channel','check_tool_account','check_credit_topup','check_batch','check_file'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I for all '
      'using (org_id = app_current_org()) with check (org_id = app_current_org())', t);
  end loop;
end$$;

-- Mutable operational data; top-ups are append-only (corrections = negative rows);
-- batches/channels/accounts archive instead of delete.
grant select, insert, update on check_channel to app_user;
grant select, insert, update on check_tool_account to app_user;
grant select, insert on check_credit_topup to app_user;
grant select, insert, update on check_batch to app_user;
grant select, insert, delete on check_file to app_user;

-- ── Seed the 'checks' permission module ──────────────────────────────────────
-- System SuperAdmin + Admin: all actions (manage accounts/top-ups, confirm, P&L).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'checks', a
from unnest(array['00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a3']) r
cross join unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- Business SuperAdmin: view.
insert into permission (org_id, role_id, module, action) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'checks', 'view')
on conflict do nothing;

-- Check employees (operational roles): view + create — record batches, register
-- their own channels. Confirming, tool-accounts/top-ups, and the P&L need approve.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'checks', a
from unnest(array[
  '00000000-0000-4000-8000-0000000000a4','00000000-0000-4000-8000-0000000000a5',
  '00000000-0000-4000-8000-0000000000a6','00000000-0000-4000-8000-0000000000a7'
]) r
cross join unnest(array['view','create']) a
on conflict do nothing;
