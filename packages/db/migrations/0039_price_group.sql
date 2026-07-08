-- ============================================================================
-- 0039_price_group.sql — ad-hoc bulk-price container (BUSINESS_MODEL_AUDIT P1
-- item 9). Several separate tasks billed together as ONE combined sum, while
-- each task keeps its own record. Makes the bare "৳0-sibling" convention
-- first-class WITHOUT touching the invoice/money-state path (the anchor-line
-- model): N consumer work_lines share a price_group_id — one ANCHOR line carries
-- the combined amount, the siblings sit at ৳0 but tagged, so "৳0 = billed in
-- group X" is explicit rather than a guess. Billing is unchanged (the anchor
-- line attaches to the invoice exactly as any consumer line).
-- ============================================================================

create table if not exists price_group (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  client_party_id uuid references party(id),  -- the client the combined price is for
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists price_group_org_idx on price_group (org_id);

alter table work_line add column if not exists price_group_id uuid references price_group(id);

-- Config data (not the money ledger): tenant-isolation RLS, full-ish grants.
alter table price_group enable row level security;
alter table price_group force row level security;
create policy tenant_isolation on price_group for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
grant select, insert, update on price_group to app_user;
