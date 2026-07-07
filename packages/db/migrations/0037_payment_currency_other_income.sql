-- ============================================================================
-- 0037_payment_currency_other_income.sql — business-side multi-currency capture
-- + a government FX-incentive income line (BUSINESS_MODEL_AUDIT P0 item 2).
--
-- The books stay BDT (story §5.5: BDT is the single primary ledger currency;
-- other currencies are recorded only as the transaction medium, converted to
-- BDT). So `payment.amount` remains the authoritative BDT figure everything
-- downstream reads — we ADD provenance columns for the foreign original + rate.
-- Deliberately the inverse column-role of the PF plane (where `amount` is the
-- as-entered figure): here `amount`=BDT, `original_amount`/`original_currency`/
-- `fx_rate` capture what was actually received and at what rate.
--
-- `other_income` is a NEW append-only business income table for money the
-- business receives that is NOT a client→writer leg — e.g. the Bangladesh govt
-- 2.5%/1000-BDT incentive on incoming foreign transfers. It is STRUCTURALLY
-- DISJOINT from payment_allocation / invoice_line so it can never net against a
-- client's dues (the story's hard rule).
-- ============================================================================

-- 1. Multi-currency provenance on the business payment ledger (amount stays BDT).
alter table payment add column if not exists original_currency text not null default 'BDT';
alter table payment add column if not exists original_amount numeric(16,2); -- the foreign figure, e.g. 100 (USDT)
alter table payment add column if not exists fx_rate numeric(18,6);          -- the manual rate applied, e.g. 125

-- 2. Business "other income" (non-client). Append-only; never linked to a client.
create table if not exists other_income (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  amount numeric(14,2) not null,                 -- BDT (the ledger currency)
  original_currency text not null default 'BDT',
  original_amount numeric(16,2),                  -- the foreign figure, if any
  fx_rate numeric(18,6),
  category text not null,                         -- govt_fx_incentive | other
  occurred_on date not null,
  source_payment_id uuid references payment(id),  -- optional: the foreign receipt the incentive was computed on
  note text,
  reverses_income_id uuid references other_income(id), -- corrections are reversing rows
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists other_income_org_idx on other_income (org_id, occurred_on);

-- Tenant-isolation RLS (org-scoped, same as expense) — admin-only income, not
-- party-scoped. Append-only: select + insert grants only (reversing entries).
alter table other_income enable row level security;
alter table other_income force row level security;
create policy tenant_isolation on other_income for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
grant select, insert on other_income to app_user;
