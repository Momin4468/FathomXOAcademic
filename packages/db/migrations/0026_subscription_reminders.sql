-- ============================================================================
-- 0026_subscription_reminders.sql — recurring expense/subscription reminders
-- (§8). A subscription expense carries a next-due date + currency + amount
-- (recorded as entered — NO FX); a 3-days-before email fires once per due-date
-- (idempotent via last_reminded_due). The actual send is the EmailService (dev
-- adapter now; real provider later) driven by a daily in-process cron + a gated
-- POST /reminders/run. No new permission module (reuses `expenses`).
-- ============================================================================

alter table expense add column if not exists next_due_date date;       -- next payment date
alter table expense add column if not exists currency text;            -- BDT|USD|GBP|EUR|AUD (recorded; no conversion)
alter table expense add column if not exists last_reminded_due date;   -- the due-date we last reminded for (idempotency)

-- Find due subscriptions efficiently (the daily scan).
create index if not exists expense_subscription_due_idx
  on expense (category, next_due_date) where archived_at is null;

-- reminder_org_ids(): the context-less daily cron can't set an RLS GUC, so it
-- enumerates tenants via this definer (org IDS ONLY — no tenant data), then runs
-- the reminder work per-org UNDER that org's RLS. Minimal exposure.
create or replace function reminder_org_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from org
$$;

revoke all on function reminder_org_ids() from public;
grant execute on function reminder_org_ids() to app_user;
