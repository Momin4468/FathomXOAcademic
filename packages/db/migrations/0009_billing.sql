-- ============================================================================
-- 0009_billing.sql — Module 5: bidirectional charges (party→business dues).
--  - charge: an amount a party OWES the business (platform fee, AI-check fee, …),
--    itemized as "amount to be paid"; append-only; corrections are reversing
--    entries (negative amount + reverses_charge_id). Party-scoped RLS like legs.
--  - payment_allocation.charge_id: a party's payment can settle a charge.
-- invoice/invoice_line/payment/payment_allocation/payment_proof already exist
-- (0000) with the right grants; balances are DERIVED from allocation sums (§I),
-- so nothing here stores paid/due.
-- ============================================================================

create table charge (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  party_id uuid not null references party(id),       -- the party who owes the business
  work_item_id uuid references work_item(id),         -- optional job link
  deal_term_id uuid references deal_term(id),          -- optional rule that produced it
  category text not null,                             -- platform_fee | ai_check | adjustment | other
  amount numeric(14,2) not null,                      -- "amount to be paid"; negative = reversing entry
  reason text,
  reverses_charge_id uuid references charge(id),       -- correction = reversing entry
  created_by uuid, created_at timestamptz not null default now()
);  -- append-only
create index charge_party_idx on charge (org_id, party_id);

alter table payment_allocation
  add column charge_id uuid references charge(id);

-- RLS: a party sees only their OWN dues (leg-style structural opacity).
alter table charge enable row level security;
alter table charge force row level security;
create policy charge_visibility on charge for all
  using (
    org_id = app_current_org()
    and (app_is_superadmin() or app_current_party() = party_id)
  )
  with check (org_id = app_current_org());

-- Append-only: insert + select only (corrections are reversing entries).
grant select, insert on charge to app_user;
