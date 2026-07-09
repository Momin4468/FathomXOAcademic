-- ============================================================================
-- 0047_pf_investments_cash.sql — PF investments + a periodic cash check-in.
-- Three account-scoped tables, each mirroring an existing PF pattern so the
-- isolation + derive-don't-store invariants hold by construction:
--   • pf_investment       — a holding with a PRINCIPAL (cost basis), like pf_loan.
--   • pf_investment_event — an append-only value log, like pf_saving_event. Current
--                           value & P/L are DERIVED at read (latest valuation vs.
--                           cost basis), NEVER stored (CLAUDE.md §3.3/§3.4).
--   • pf_cash_checkin     — an append-only declared-cash-on-hand snapshot; the
--                           discrepancy vs. the ledger is derived at read.
-- Investment TYPES reuse pf_category with kind='investment' (no new table).
-- RLS is the SAME pf_account_isolation as every pf_* table — no superadmin clause,
-- so the business plane (which never sets app.pf_account_id) reads zero rows.
-- ============================================================================

-- ─── pf_investment: a holding; principal = the initial cost basis (immutable) ──
create table pf_investment (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  category_id uuid references pf_category(id),      -- an investment TYPE (kind='investment')
  name text not null,
  principal numeric(16,2) not null,                 -- initial cost basis; further money via events
  currency text not null default 'BDT',
  started_on date not null,
  note text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index pf_investment_acct_idx on pf_investment (pf_account_id);

-- ─── pf_investment_event: append-only value log (mirror of pf_saving_event) ────
-- kind: valuation (absolute current-value mark) | contribution | withdrawal.
create table pf_investment_event (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  investment_id uuid not null references pf_investment(id),
  kind text not null,                               -- valuation | contribution | withdrawal
  amount numeric(16,2) not null,
  occurred_on date not null,
  note text,
  reverses_id uuid references pf_investment_event(id),
  created_at timestamptz not null default now()
);
create index pf_investment_event_inv_idx on pf_investment_event (pf_account_id, investment_id);

-- ─── pf_cash_checkin: append-only declared cash-on-hand snapshot ───────────────
create table pf_cash_checkin (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  as_of date not null,
  declared_amount numeric(16,2) not null,
  currency text not null default 'BDT',
  note text,
  created_at timestamptz not null default now()
);
create index pf_cash_checkin_acct_idx on pf_cash_checkin (pf_account_id, as_of);

-- ============================================================================
-- RLS — identical pf_account_isolation as 0027 (no superadmin clause).
-- ============================================================================
do $$
declare
  t text;
  pf_tables text[] := array['pf_investment', 'pf_investment_event', 'pf_cash_checkin'];
begin
  foreach t in array pf_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy pf_account_isolation on %I for all '
      'using (pf_account_id = app_current_pf_account()) '
      'with check (pf_account_id = app_current_pf_account())', t);
  end loop;
end$$;

-- ─── Grants (same append-only tiering as the rest of PF) ──────────────────────
-- Mutable definition (edit/archive the holding — not a money row).
grant select, insert, update on pf_investment to app_user;
-- Append-only ledgers: the value log + the cash declarations (corrections = a new row).
grant select, insert on pf_investment_event, pf_cash_checkin to app_user;

-- ─── Seed investment TYPES for NEW accounts (extend pf_register) ───────────────
-- Re-create pf_register with a third seed loop; existing behaviour unchanged.
create or replace function pf_register(
  p_email citext, p_password_hash text, p_display_name text, p_base_currency text
) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_name text;
begin
  insert into pf_account (email, password_hash, display_name, base_currency)
  values (p_email, p_password_hash, p_display_name, coalesce(p_base_currency, 'BDT'))
  on conflict (email) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;  -- email taken
  foreach v_name in array array['Salary','Freelance','Business payout','Gift','Other'] loop
    insert into pf_category (pf_account_id, kind, name) values (v_id, 'income', v_name);
  end loop;
  foreach v_name in array array['Food','Rent','Transport','Bills','Shopping','Health','Other'] loop
    insert into pf_category (pf_account_id, kind, name) values (v_id, 'expense', v_name);
  end loop;
  foreach v_name in array array['Stocks','Property','Business','Crypto','Fund','Other'] loop
    insert into pf_category (pf_account_id, kind, name) values (v_id, 'investment', v_name);
  end loop;
  return v_id;
end $$;
revoke all on function pf_register(citext, text, text, text) from public;
grant execute on function pf_register(citext, text, text, text) to app_user;

-- ─── Backfill investment TYPES for EXISTING accounts (one-time) ────────────────
-- Runs owner-rights (migration superuser), so RLS doesn't hide other accounts.
insert into pf_category (pf_account_id, kind, name)
select a.id, 'investment', t.name
from pf_account a
cross join (values ('Stocks'), ('Property'), ('Business'), ('Crypto'), ('Fund'), ('Other')) t(name);
