-- ============================================================================
-- 0027_personal_finance.sql — The Personal Finance plane (DESIGN_SPEC §11).
--
-- A SEPARATE, independently-sellable service that shares this database for now
-- but is designed as its own plane so a physical split is later a swap, not a
-- rewrite. It has its OWN identity (pf_account, separate credentials), its OWN
-- data (pf_*), and joins the business by exactly one seam: a ONE-WAY income
-- bridge (a business payout pushes a pf_income row in; the business — even
-- SuperAdmin — can NEVER read back).
--
-- TENANCY: the PF plane's tenant unit is the ACCOUNT, not an org. Every pf_*
-- table carries pf_account_id (the PF analogue of org_id) and is RLS-scoped by
-- the new GUC `app.pf_account_id`. These policies deliberately do NOT honor the
-- business `app.is_superadmin` GUC — that bypass is business-leg-only. A business
-- transaction never sets app.pf_account_id, so app_current_pf_account() is NULL
-- for it and every pf_* row is invisible to the business. That is the structural
-- privacy guarantee (§4.1, §11) — enforced at the database, not the UI.
--
-- MONEY: append-only (money rows are corrected by reversing entries, never
-- edited/deleted); balances/outstanding/target-progress are DERIVED at read,
-- never stored (CLAUDE.md §3.3/§3.4). Multi-currency is RECORDED as entered with
-- no forced FX; an optional user-entered converted amount may accompany it.
-- ============================================================================

-- ─── PF plane context accessor (null-safe; missing context => NULL => no rows) ─
create or replace function app_current_pf_account() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.pf_account_id', true), '')::uuid
$$;

-- ─── pf_account: the separate identity (tenant root; like org, keyed on id) ───
-- status is INDEPENDENT of user_account.status: deactivating a brokerage login
-- never touches this. linked_party_id is a SOFT link (no FK cascade) so the bond
-- survives a deactivated/removed business account.
create table pf_account (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  twofa_secret text,                              -- sealed (enc:) AES-GCM at rest
  status text not null default 'active',          -- active | deactivated (PF-only)
  display_name text,
  base_currency text not null default 'BDT',
  linked_party_id uuid,                           -- soft link to a business party (§11)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A business party links to AT MOST one pf account (prevents a second account
-- claiming the same party's income stream).
create unique index pf_account_linked_party_uidx
  on pf_account (linked_party_id) where linked_party_id is not null;

-- ─── pf_refresh_token: hashed, rotating, per-device (mirror of auth_refresh_token)
create table pf_refresh_token (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  token_hash text not null,
  device_label text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index pf_refresh_token_acct_idx on pf_refresh_token (pf_account_id);
create index pf_refresh_token_hash_idx on pf_refresh_token (pf_account_id, token_hash);

-- ─── pf_category: USER-DEFINED income/expense categories (not a fixed list) ───
create table pf_category (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  kind text not null,                             -- income | expense
  name text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index pf_category_acct_idx on pf_category (pf_account_id, kind);

-- ─── pf_income: arbitrary date/amount/note; multi-currency; optional conversion ─
-- source='business_payout' rows arrive via the one-way bridge keyed by source_ref
-- (the originating payment_allocation id) for idempotency. Append-only.
create table pf_income (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  category_id uuid references pf_category(id),
  amount numeric(16,2) not null,
  currency text not null default 'BDT',           -- recorded as entered; NO forced FX
  converted_amount numeric(16,2),                 -- optional user-entered conversion
  converted_currency text,
  occurred_on date not null,
  note text,
  source text not null default 'manual',          -- manual | business_payout
  source_ref text,                                -- originating payment_allocation id (bridge)
  source_party_id uuid,                           -- which business party paid (opaque label)
  reverses_id uuid references pf_income(id),       -- correction = reversing entry (append-only)
  created_at timestamptz not null default now()
);
create index pf_income_acct_idx on pf_income (pf_account_id, occurred_on);
-- Bridge idempotency: one income row per (account, source allocation).
create unique index pf_income_source_uidx
  on pf_income (pf_account_id, source_ref) where source_ref is not null;

-- ─── pf_expense: arbitrary date/amount/note; multi-currency; optional conversion ─
create table pf_expense (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  category_id uuid references pf_category(id),
  amount numeric(16,2) not null,
  currency text not null default 'BDT',
  converted_amount numeric(16,2),
  converted_currency text,
  occurred_on date not null,
  note text,
  reverses_id uuid references pf_expense(id),
  created_at timestamptz not null default now()
);
create index pf_expense_acct_idx on pf_expense (pf_account_id, occurred_on);

-- ─── pf_loan: money given/taken; outstanding DERIVED from principal ∓ events ───
create table pf_loan (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  direction text not null,                        -- given | taken
  counterparty_name text not null,
  principal numeric(16,2) not null,
  currency text not null default 'BDT',
  started_on date not null,
  due_on date,
  note text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index pf_loan_acct_idx on pf_loan (pf_account_id);

create table pf_loan_event (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  loan_id uuid not null references pf_loan(id),
  kind text not null,                             -- repayment | disbursement | adjustment
  amount numeric(16,2) not null,
  occurred_on date not null,
  note text,
  reverses_id uuid references pf_loan_event(id),
  created_at timestamptz not null default now()
);
create index pf_loan_event_loan_idx on pf_loan_event (pf_account_id, loan_id);

-- ─── pf_saving: pots; balance DERIVED from Σ(deposits − withdrawals) ──────────
create table pf_saving (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  name text not null,
  currency text not null default 'BDT',
  target_amount numeric(16,2),
  note text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index pf_saving_acct_idx on pf_saving (pf_account_id);

create table pf_saving_event (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  saving_id uuid not null references pf_saving(id),
  kind text not null,                             -- deposit | withdraw
  amount numeric(16,2) not null,
  occurred_on date not null,
  note text,
  reverses_id uuid references pf_saving_event(id),
  created_at timestamptz not null default now()
);
create index pf_saving_event_saving_idx on pf_saving_event (pf_account_id, saving_id);

-- ─── pf_target: budgets/goals; progress DERIVED at read (never stored) ────────
create table pf_target (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  kind text not null,                             -- budget_cap | income_goal | savings_target
  category_id uuid references pf_category(id),
  period text not null,                           -- month | year
  period_start date not null,
  amount numeric(16,2) not null,
  currency text not null default 'BDT',
  note text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index pf_target_acct_idx on pf_target (pf_account_id);

-- ─── pf_subscription: next-due tracking + the 3-days-before email reminder ────
-- Mirrors the business expense reminder; reuses the SAME EmailService pipeline.
create table pf_subscription (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  name text not null,
  category_id uuid references pf_category(id),
  amount numeric(16,2) not null,
  currency text not null default 'BDT',
  next_due_date date,
  last_reminded_due date,                         -- idempotency per due-date
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index pf_subscription_due_idx
  on pf_subscription (pf_account_id, next_due_date) where archived_at is null;

-- ─── pf_audit_log: PF-account-scoped provenance (separate from business audit) ─
create table pf_audit_log (
  id bigint primary key generated always as identity,
  pf_account_id uuid not null references pf_account(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  detail_json jsonb,
  at timestamptz not null default now()
);
create index pf_audit_log_acct_idx on pf_audit_log (pf_account_id, at);

-- ─── pf_link_token: the one-way LINK seam (business mints; PF consumes) ────────
-- Touched ONLY by the two SECURITY DEFINER functions below — app_user gets no
-- direct grant and there is no policy, so neither plane can read it directly.
create table pf_link_token (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null,
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index pf_link_token_hash_uidx on pf_link_token (token_hash);

-- ============================================================================
-- RLS — every pf_* table is isolated to ONE account by app.pf_account_id.
-- NB: NO superadmin clause anywhere here. pf_account/pf_link_token are special.
-- ============================================================================
do $$
declare
  t text;
  pf_tables text[] := array[
    'pf_category','pf_income','pf_expense','pf_loan','pf_loan_event',
    'pf_saving','pf_saving_event','pf_target','pf_subscription','pf_audit_log'
  ];
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

-- pf_account: tenant root — a logged-in account may read/update ONLY its own row
-- (keyed on id, like org). Registration/login go through definers (no context).
alter table pf_account enable row level security;
alter table pf_account force row level security;
create policy pf_account_self on pf_account for all
  using (id = app_current_pf_account())
  with check (id = app_current_pf_account());

-- pf_refresh_token: account-scoped (mutable: rotate/revoke).
alter table pf_refresh_token enable row level security;
alter table pf_refresh_token force row level security;
create policy pf_account_isolation on pf_refresh_token for all
  using (pf_account_id = app_current_pf_account())
  with check (pf_account_id = app_current_pf_account());

-- pf_link_token: RLS on with NO policy and NO grants → app_user can't touch it
-- at all; only the owner-rights definers below read/write it.
alter table pf_link_token enable row level security;
alter table pf_link_token force row level security;

-- ─── Privileges (same append-only tiering as the business plane) ──────────────
-- Mutable definitions (user can edit/archive these — they are not money rows).
grant select, insert, update on
  pf_account, pf_category, pf_loan, pf_saving, pf_target, pf_subscription
  to app_user;
-- Mutable-but-never-hard-deleted: refresh tokens (rotate/revoke).
grant select, insert, update on pf_refresh_token to app_user;
-- Append-only ledgers: money + audit (insert/select only — corrections reverse).
grant select, insert on
  pf_income, pf_expense, pf_loan_event, pf_saving_event, pf_audit_log
  to app_user;
grant usage, select on all sequences in schema public to app_user;

-- ============================================================================
-- SECURITY DEFINER functions — the sanctioned bypasses (owner-rights, narrow).
-- ============================================================================

-- pf_auth_lookup: the PF login bypass (mirror of app_auth_lookup). Auth cols only.
create or replace function pf_auth_lookup(p_email citext)
returns table (id uuid, password_hash text, status text, twofa_secret text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select a.id, a.password_hash, a.status, a.twofa_secret
  from pf_account a
  where a.email = p_email
$$;
revoke all on function pf_auth_lookup(citext) from public;
grant execute on function pf_auth_lookup(citext) to app_user;

-- pf_register: self-service account creation (no context exists pre-login).
-- Atomically inserts the account and seeds default categories. Returns the new
-- id, or NULL if the email already exists (caller maps NULL → 409).
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
  return v_id;
end $$;
revoke all on function pf_register(citext, text, text, text) from public;
grant execute on function pf_register(citext, text, text, text) to app_user;

-- pf_push_income: THE ONE-WAY BRIDGE WRITE. Called from a BUSINESS transaction
-- when a payout is allocated to a writer. Resolves the pf_account linked to the
-- party (if any) and inserts income, idempotent on source_ref. Returns VOID —
-- the business learns NOTHING (not even whether a linked account exists).
create or replace function pf_push_income(
  p_party_id uuid, p_amount numeric, p_currency text, p_occurred_on date, p_source_ref text
) returns void
language sql volatile security definer set search_path = public, pg_temp
as $$
  insert into pf_income (pf_account_id, amount, currency, occurred_on, source, source_ref, source_party_id)
  select a.id, p_amount, coalesce(p_currency, 'BDT'), p_occurred_on, 'business_payout', p_source_ref, p_party_id
  from pf_account a
  where a.linked_party_id = p_party_id
  on conflict (pf_account_id, source_ref) where source_ref is not null do nothing
$$;
revoke all on function pf_push_income(uuid, numeric, text, date, text) from public;
grant execute on function pf_push_income(uuid, numeric, text, date, text) to app_user;

-- pf_mint_link_token: BUSINESS side of the link. Verifies the party belongs to
-- the caller's org (defense in depth) then stores a hashed, expiring token.
create or replace function pf_mint_link_token(
  p_party_id uuid, p_token_hash text, p_expires_at timestamptz
) returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from party where id = p_party_id and org_id = app_current_org()) then
    raise exception 'party not in caller org';
  end if;
  insert into pf_link_token (party_id, token_hash, expires_at)
  values (p_party_id, p_token_hash, p_expires_at);
end $$;
revoke all on function pf_mint_link_token(uuid, text, timestamptz) from public;
grant execute on function pf_mint_link_token(uuid, text, timestamptz) to app_user;

-- pf_consume_link_token: PF side of the link. Runs in a PF transaction. Sets the
-- calling account's linked_party_id and BACKFILLS past business payouts to that
-- party as income (idempotent). Returns the party id + backfilled count — never
-- any business data. This keeps the bridge one-way: income flows IN, nothing
-- business-side is exposed to the PF caller.
create or replace function pf_consume_link_token(p_token_hash text)
returns table (party_id uuid, backfilled int)
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v_party uuid; v_acct uuid; v_count int;
begin
  v_acct := app_current_pf_account();
  if v_acct is null then raise exception 'no pf account context'; end if;
  select t.party_id into v_party
  from pf_link_token t
  where t.token_hash = p_token_hash and t.consumed_at is null and t.expires_at > now()
  for update;
  if v_party is null then raise exception 'invalid or expired link token'; end if;
  update pf_link_token set consumed_at = now() where token_hash = p_token_hash;
  update pf_account set linked_party_id = v_party, updated_at = now() where id = v_acct;
  insert into pf_income (pf_account_id, amount, currency, occurred_on, source, source_ref, source_party_id)
  select v_acct, pa.amount, 'BDT', p.paid_at, 'business_payout', pa.id::text, pa.writer_party_id
  from payment_allocation pa
  join payment p on p.id = pa.payment_id and p.direction = 'out'
  where pa.writer_party_id = v_party
  on conflict (pf_account_id, source_ref) where source_ref is not null do nothing;
  get diagnostics v_count = row_count;
  party_id := v_party; backfilled := v_count; return next;
end $$;
revoke all on function pf_consume_link_token(text) from public;
grant execute on function pf_consume_link_token(text) to app_user;

-- pf_reminder_account_ids: ids-only enumerator so the context-less daily cron can
-- sweep each PF tenant under its own RLS (mirror of reminder_org_ids).
create or replace function pf_reminder_account_ids()
returns table (id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$ select id from pf_account where status = 'active' $$;
revoke all on function pf_reminder_account_ids() from public;
grant execute on function pf_reminder_account_ids() to app_user;
