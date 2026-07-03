-- ============================================================================
-- 0035_pf_planner.sql — Personal Finance planner polish (§11, Module 14).
-- Three NEW account-scoped tables. Same pf_* convention as 0027: tenant axis is
-- pf_account_id, RLS enable+force with pf_account_isolation, NO superadmin clause
-- (business/SuperAdmin read ZERO rows). None store a derived money balance — all
-- insight/budget/anomaly figures stay derived-at-read; these are config + a
-- notification/usage log (like last_reminded_*).
-- ============================================================================

-- ─── pf_preferences: one row per account — the PF settings ("sensible defaults") ─
create table if not exists pf_preferences (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  rollup_period text not null default 'month'
    check (rollup_period in ('week', 'month', 'custom')),
  rollup_custom_days int not null default 30,
  subscription_lead_days int not null default 3,
  reminder_subscriptions boolean not null default true,
  reminder_notes boolean not null default true,
  anomaly_enabled boolean not null default true,
  anomaly_threshold_pct int not null default 150,   -- sensitivity: flag ≥ avg × pct/100
  active_currencies text[] not null default '{BDT,USD,GBP,EUR,AUD}',
  default_budget_period text not null default 'month'
    check (default_budget_period in ('month', 'year')),
  ai_quickadd_enabled boolean not null default true,
  prefs_json jsonb,                                  -- forward-compat, no migration needed
  updated_at timestamptz not null default now()
);
create unique index if not exists pf_preferences_acct_uidx on pf_preferences (pf_account_id);

-- ─── pf_anomaly_notice: dedup + dismissible in-app alert (NOT a stored balance) ──
create table if not exists pf_anomaly_notice (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  kind text not null check (kind in ('period_total', 'category')),
  period_key text not null,                          -- e.g. 2026-07, 2026-W27, or a custom-range key
  category_id uuid,                                  -- null for period_total
  observed numeric(16,2) not null,
  baseline numeric(16,2) not null,
  currency text not null default 'BDT',
  created_at timestamptz not null default now(),
  dismissed_at timestamptz
);
-- One notice per (account, kind, period, category). coalesce so period_total
-- (null category) dedups too (Postgres treats raw nulls as distinct).
create unique index if not exists pf_anomaly_notice_uidx on pf_anomaly_notice
  (pf_account_id, kind, period_key, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists pf_anomaly_notice_active_idx on pf_anomaly_notice (pf_account_id, dismissed_at);

-- ─── pf_ai_usage: PF-scoped daily cap for AI quick-add. MUST stay in the PF plane
-- (never the business ai_usage table) so a PF action can't leak into the business.
create table if not exists pf_ai_usage (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  day date not null,
  count int not null default 0
);
create unique index if not exists pf_ai_usage_acct_day_uidx on pf_ai_usage (pf_account_id, day);

-- ─── RLS — account-isolated, no superadmin clause (mirror 0027) ──────────────────
do $$
declare
  t text;
  pf_tables text[] := array['pf_preferences', 'pf_anomaly_notice', 'pf_ai_usage'];
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

-- ─── Privileges: all three are mutable config/state (select, insert, update) ─────
-- pf_preferences: user edits. pf_anomaly_notice: insert on detect, update to dismiss.
-- pf_ai_usage: upsert-increment. None hard-delete.
grant select, insert, update on pf_preferences, pf_anomaly_notice, pf_ai_usage to app_user;
grant usage, select on all sequences in schema public to app_user;
