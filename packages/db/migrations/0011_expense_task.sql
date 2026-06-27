-- ============================================================================
-- 0011_expense_task.sql — Module 6: expenses (cost-bearer) + task board.
--  - expense (SCHEMA §G): every cost carries a cost-bearer; salaries,
--    subscriptions, promo, losses, events are all flavors of this one table.
--  - task: tz-aware deadlines (absolute due_at + the zone it was set in) for the
--    capture-first board. Both are mutable operational data (full CRUD), NOT the
--    append-only ledger. Tenant-RLS like the rest of the spine.
-- ============================================================================

create table expense (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  category text not null,                    -- subscription | salary | promo | loss | event | other
  amount numeric(14,2) not null,
  incurred_at date not null,
  cost_bearer text not null,                 -- momin | emon | split | writer
  cost_bearer_split_json jsonb,              -- when 'split'
  payee_party_id uuid references party(id),
  campaign_tag text,                         -- optional (promo)
  revenue_link_id uuid,                      -- optional attributable income (loose link)
  receipt_file_id uuid references file_object(id),
  note text,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index expense_incurred_idx on expense (org_id, incurred_at);
create index expense_cost_bearer_idx on expense (org_id, cost_bearer);

create table task (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  title text not null,
  details text,
  state text not null default 'open',        -- open | done | cancelled
  due_at timestamptz,                        -- absolute moment (UTC)
  due_tz text,                               -- IANA zone it was set in (e.g. 'Australia/Sydney')
  assignee_party_id uuid references party(id),
  assignee_user_id uuid references user_account(id),
  work_item_id uuid references work_item(id),
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index task_state_due_idx on task (org_id, state, due_at);
create index task_assignee_idx on task (org_id, assignee_party_id);

-- ─── RLS: tenant isolation (reuse the 0001 pattern) ─────────────────────────
alter table expense enable row level security;
alter table expense force row level security;
create policy tenant_isolation on expense for all
  using (org_id = app_current_org()) with check (org_id = app_current_org());

alter table task enable row level security;
alter table task force row level security;
create policy tenant_isolation on task for all
  using (org_id = app_current_org()) with check (org_id = app_current_org());

-- Mutable operational data → full CRUD for the app role.
grant select, insert, update, delete on expense to app_user;
grant select, insert, update, delete on task to app_user;
