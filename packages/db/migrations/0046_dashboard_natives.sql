-- ============================================================================
-- 0046_dashboard_natives.sql — native dashboard/leaderboard read-models.
-- The `analytics` schema (0029) already holds redaction-safe AGGREGATE views,
-- but they were granted only to `analytics_ro` (Metabase) and group by org_id
-- without filtering. As the in-app charts replace the Metabase embed, this
-- migration adds thin SECURITY DEFINER wrappers that expose those same views to
-- app_user, each SCOPED to `app_current_org()`. Same pattern as the 0024
-- dashboard definers: aggregate-only, org-scoped, rollups never raw legs.
--
-- Opacity (§4.4/§4.5): the money-bearing wrappers (org_net, expense_totals) are
-- reached only through the dashboard:approve (owner) section in-service; the
-- LEADERBOARD wrappers (work_volume, writer_reputation) carry NO money column at
-- all — the source views expose only counts/rates/quality. No per-job price and
-- no per-partner private margin is ever emitted.
-- ============================================================================

-- ── leaderboard sources (MONEY-FREE — safe for every viewer) ─────────────────

-- Per-doer job counts (total / delivered / open). Counts only.
create or replace function dashboard_work_volume()
returns table (party_id uuid, total_jobs int, delivered int, open_jobs int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select party_id, total_jobs, delivered, open_jobs
  from analytics.work_volume
  -- ⚠️ SOLE TENANT BOUNDARY. analytics.work_volume is a superuser-owned view that
  -- BYPASSES RLS (it returns every org's rows). This org filter is the ONLY thing
  -- scoping the result to the caller's tenant — there is NO RLS backstop under it.
  -- Do not remove, widen, or make it conditional. (Cross-org isolation is asserted
  -- by dashboard-natives.test.ts; see DECISIONS 2026-07-09 on why no RLS layer fits.)
  where org_id = app_current_org()
$$;
revoke all on function dashboard_work_volume() from public;
grant execute on function dashboard_work_volume() to app_user;

-- Per-writer reputation aggregates (mirrors deriveReputation). NO money column —
-- reworkCost lives only in the TS struct, never in the analytics view.
create or replace function dashboard_writer_reputation()
returns table (
  writer_party_id uuid, jobs int, on_time_rate numeric, avg_days_late numeric,
  revision_rate numeric, complaints int, failed int, fail_rate numeric,
  avg_ai_score numeric, reliability_score numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select writer_party_id, jobs, on_time_rate, avg_days_late, revision_rate,
         complaints, failed, fail_rate, avg_ai_score, reliability_score
  from analytics.writer_reputation
  -- ⚠️ SOLE TENANT BOUNDARY. analytics.writer_reputation is superuser-owned and
  -- BYPASSES RLS (all orgs). This org filter is the ONLY tenant scope — no RLS
  -- backstop. Do not remove/widen it. (Verified by dashboard-natives.test.ts.)
  where org_id = app_current_org()
$$;
revoke all on function dashboard_writer_reputation() from public;
grant execute on function dashboard_writer_reputation() to app_user;

-- ── owner-only sources (money; reached only via the dashboard:approve section) ─

-- Org net headline (§4.5 "agg"; org total, not attributable to any partner).
create or replace function dashboard_org_net()
returns table (revenue numeric, writer_cost numeric, net numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select revenue, writer_cost, net
  from analytics.org_net
  -- ⚠️ SOLE TENANT BOUNDARY. analytics.org_net is superuser-owned and BYPASSES RLS
  -- (all orgs). This org filter is the ONLY tenant scope AND, because these are
  -- MARGIN figures, a missing/loosened filter leaks another org's revenue+net. No
  -- RLS backstop exists (and can't — see DECISIONS 2026-07-09). Never touch it.
  where org_id = app_current_org()
$$;
revoke all on function dashboard_org_net() from public;
grant execute on function dashboard_org_net() to app_user;

-- Monthly expense rollups (owner breakdown/trend). No receipt detail.
create or replace function dashboard_expense_totals()
returns table (month date, category text, cost_bearer text, total numeric, items int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select month, category, cost_bearer, total, items
  from analytics.expense_totals
  -- ⚠️ SOLE TENANT BOUNDARY. analytics.expense_totals is superuser-owned and
  -- BYPASSES RLS (all orgs). This org filter is the ONLY tenant scope for these
  -- money totals — no RLS backstop. Never remove/widen it.
  where org_id = app_current_org()
  order by month
$$;
revoke all on function dashboard_expense_totals() from public;
grant execute on function dashboard_expense_totals() to app_user;

-- ── new: org net BY MONTH (the trend line) ───────────────────────────────────
-- Same revenue/writer_cost definitions as analytics.org_net (0029), grouped by
-- the job's month. Superuser-owned view (bypasses RLS); org stays a COLUMN and
-- the definer wrapper filters it. Aggregate/org-level only — never per-partner.
create or replace view analytics.org_net_monthly as
  select wi.org_id,
         date_trunc('month', wi.created_at)::date as month,
         coalesce(sum(j.revenue), 0) as revenue,
         coalesce(sum(j.writer_cost), 0) as writer_cost,
         coalesce(sum(j.revenue - j.writer_cost), 0) as net
  from work_item wi
  cross join lateral (
    select
      coalesce((
        select sum(l.amount) from leg l
        where l.work_item_id = wi.id and l.org_id = wi.org_id
          and wi.source_party_id is not null and l.from_party_id = wi.source_party_id
      ), 0) as revenue,
      coalesce((
        select sum(l.amount) from leg l join party p on p.id = l.to_party_id
        where l.work_item_id = wi.id and l.org_id = wi.org_id
          and p.party_type @> array['writer']::text[]
          and (wi.source_party_id is null or l.from_party_id is distinct from wi.source_party_id)
      ), 0) as writer_cost
  ) j
  where wi.archived_at is null
  group by wi.org_id, date_trunc('month', wi.created_at);

grant select on analytics.org_net_monthly to analytics_ro;

create or replace function dashboard_org_net_monthly()
returns table (month date, revenue numeric, writer_cost numeric, net numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select month, revenue, writer_cost, net
  from analytics.org_net_monthly
  -- ⚠️ SOLE TENANT BOUNDARY. analytics.org_net_monthly is superuser-owned and
  -- BYPASSES RLS (all orgs). These are MARGIN figures, so this org filter is the
  -- ONLY thing keeping one org's revenue/net out of another's chart — no RLS
  -- backstop exists (and can't). Never remove/widen it.
  where org_id = app_current_org()
  order by month
$$;
revoke all on function dashboard_org_net_monthly() from public;
grant execute on function dashboard_org_net_monthly() to app_user;
