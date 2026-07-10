-- ============================================================================
-- 0049_opening_balance.sql — a one-time OPENING BALANCE per party (and the
-- business overall), as its OWN clearly-labeled entry type (Phase 5).
--
-- This is a real starting point that feeds the DERIVED balance as a constant —
-- it is deliberately NOT a synthetic backdated job / payment / leg (those would
-- pollute the work + money ledgers and the P&L). A migrating business enters what
-- each writer/party was owed (or owed us) as of a chosen date; from there the
-- normal legs/payments carry the balance forward.
--
--   • `amount` is SIGNED: + means the party is owed (adds to their net position),
--     − means they owe the business (a starting due).
--   • `party_id` NULL = the business overall (a single opening figure for the org).
--   • `as_of` is a real date and MAY be in the past — backdating is always allowed.
--   • Append-only (select/insert): a mistake is corrected with a REVERSING entry
--     (negated amount, reverses_id), never an edit — same discipline as the ledger.
--   • The balance stays DERIVED at read (Σ opening_balance for the party); nothing
--     is stored as a running total, so the no-stored-profit guard is satisfied.
-- ============================================================================

create table if not exists opening_balance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  party_id uuid references party(id),           -- null = the business overall
  amount numeric(16,2) not null,                -- signed: + owed to party, − owed by party
  currency text not null default 'BDT',
  as_of date not null,
  note text,
  reverses_id uuid references opening_balance(id),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists opening_balance_party_idx on opening_balance (org_id, party_id);

-- ─── RLS: tenant isolation (mirror advance 0042) ──────────────────────────────
alter table opening_balance enable row level security;
alter table opening_balance force row level security;
create policy tenant_isolation on opening_balance for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
-- Append-only: select/insert only — a correction is a reversing entry, never an edit.
grant select, insert on opening_balance to app_user;
