-- ============================================================================
-- 0029_analytics.sql — The BI/analytics plane (DESIGN_SPEC §8).
--
-- Embedded Metabase reads ONLY this `analytics` schema of REDACTED, AGGREGATE
-- views — never base tables. The opacity guarantees (§4.4/§4.5) hold THROUGH BI:
--
--  • A dedicated read-only role `analytics_ro` is granted SELECT on the analytics
--    views and NOTHING else — no base table (leg, payment, invoice, charge,
--    pf_*, deal_term, credential_vault_item), no GUC-scoped definer. Even the
--    SuperAdmin ad-hoc query builder is bounded by these grants.
--  • The views are owned by the migration superuser, so they read across FORCE
--    RLS; the redaction is the VIEW SQL itself + the locked Metabase embed param.
--  • Views carry org_id (and party_id where party-scoped) as COLUMNS; the API's
--    signed embed LOCKS those params per the viewer's role so a viewer can never
--    widen scope. No raw leg, no per-partner PRIVATE margin (settlement shows the
--    shared pool only), no pf_* — aggregate/derived only, never stored.
--
-- NB: derived money columns are named `net` (never the reserved words the
-- no-stored guard forbids); the "profit"/"margin" words live only in TS.
-- ============================================================================

create schema if not exists analytics;

-- IMPORTANT: these views bypass RLS (superuser-owned), so a per-PARTY money
-- breakdown would show one partner the OTHER's private client price/margin
-- (the in-app dashboard hides that via per-viewer RLS; BI has no such context).
-- So money is exposed at the ORG level only (§4.5 "agg"); per-party views below
-- carry NO client price / chain margin — only counts, writer cost (pay), quality,
-- and a party's OWN balance (member dashboard, locked to party_id). The
-- partner-private margin / private split (§4.4/§4.5 "—") is therefore never a
-- queryable BI figure; settlement exposes the SHARED pool only.

-- ── org net (the §4.5 "agg" headline; org total, not attributable to a partner) ─
-- revenue = Σ legs FROM each job's source (client); writer_cost = Σ legs TO
-- writer parties excluding the client→partner handoff; net = revenue − cost.
create or replace view analytics.org_net as
  select wi.org_id,
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
  group by wi.org_id;

-- ── writer cost per doer (jobs + writer PAY only — NO revenue/net) ───────────
-- writer_cost = what we pay the writer (an owner figure, §4.5 "writer pay"); it
-- is never the upstream's client price, so no partner-private margin leaks.
create or replace view analytics.writer_cost as
  select wi.org_id,
         wi.doer_party_id as writer_party_id,
         count(*)::int as jobs,
         coalesce(sum(wc.writer_cost), 0) as writer_cost
  from work_item wi
  cross join lateral (
    select coalesce((
      select sum(l.amount) from leg l join party p on p.id = l.to_party_id
      where l.work_item_id = wi.id and l.org_id = wi.org_id
        and p.party_type @> array['writer']::text[]
        and (wi.source_party_id is null or l.from_party_id is distinct from wi.source_party_id)
    ), 0) as writer_cost
  ) wc
  where wi.doer_party_id is not null and wi.archived_at is null
  group by wi.org_id, wi.doer_party_id;

-- ── org receivables (ORG total invoiced/paid/due — NOT per-client price) ─────
create or replace view analytics.org_receivables as
  select i.org_id,
         coalesce(sum(il.amount), 0) as invoiced,
         coalesce(sum(pa.amt), 0) as paid,
         coalesce(sum(il.amount), 0) - coalesce(sum(pa.amt), 0) as due
  from invoice i
  join invoice_line il on il.invoice_id = i.id
  left join lateral (
    select coalesce(sum(amount), 0) as amt
    from payment_allocation pa
    where pa.invoice_line_id = il.id
  ) pa on true
  where i.status <> 'void'
  group by i.org_id;

-- ── settlement shared position (SHARED pool only; never a private client leg) ──
-- For each inter-partner handoff (both ends are partners) the pool = handoff −
-- the downstream partner's writer cost. Aggregated by the unordered partner pair.
-- This is the agreed figure both partners are entitled to (§4.4); neither's
-- upstream private client leg nor private margin is ever emitted.
create or replace view analytics.settlement_position as
  with handoff as (
    select h.org_id,
           least(h.from_party_id, h.to_party_id) as partner_a,
           greatest(h.from_party_id, h.to_party_id) as partner_b,
           (h.amount - coalesce(w.writer_cost, 0)) as pool
    from leg h
    join party pf on pf.id = h.from_party_id and pf.party_type @> array['partner']::text[]
    join party pt on pt.id = h.to_party_id and pt.party_type @> array['partner']::text[]
    left join lateral (
      select coalesce(sum(o.amount), 0) as writer_cost
      from leg o
      where o.work_item_id = h.work_item_id
        and o.from_party_id = h.to_party_id
        and (o.to_party_id is null or o.to_party_id not in (h.from_party_id, h.to_party_id))
    ) w on true
    where h.from_party_id <> h.to_party_id
  ),
  pool_agg as (
    select org_id, partner_a, partner_b,
           count(*)::int as shared_jobs,
           round(sum(pool)::numeric, 2) as pool
    from handoff
    group by org_id, partner_a, partner_b
  ),
  transfer_agg as (
    select org_id,
           least(from_party_id, to_party_id) as partner_a,
           greatest(from_party_id, to_party_id) as partner_b,
           round(sum(case when from_party_id = least(from_party_id, to_party_id)
                          then amount else -amount end)::numeric, 2) as transfers_net
    from settlement_transfer
    group by org_id, least(from_party_id, to_party_id), greatest(from_party_id, to_party_id)
  )
  select p.org_id, p.partner_a, p.partner_b, p.shared_jobs, p.pool,
         coalesce(t.transfers_net, 0) as transfers_net
  from pool_agg p
  left join transfer_agg t
    on t.org_id = p.org_id and t.partner_a = p.partner_a and t.partner_b = p.partner_b;

-- ── work volume per doer (counts only — both partners may see work volume) ────
create or replace view analytics.work_volume as
  select org_id,
         doer_party_id as party_id,
         count(*)::int as total_jobs,
         count(*) filter (where work_state = 'delivered')::int as delivered,
         count(*) filter (where work_state in ('draft', 'pending', 'confirmed'))::int as open_jobs
  from work_item
  where doer_party_id is not null and archived_at is null
  group by org_id, doer_party_id;

-- ── writer reputation aggregates (mirrors deriveReputation; never per-job rows) ─
create or replace view analytics.writer_reputation as
  with raw as (
    select wi.org_id, wi.doer_party_id as writer_party_id,
           count(*)::int as jobs,
           count(*) filter (where o.on_time is not null)::int as on_time_measured,
           count(*) filter (where o.on_time)::int as on_time_yes,
           round(avg(o.days_late) filter (where o.days_late is not null), 2) as avg_days_late,
           round(avg(o.revision_count)::numeric, 2) as revision_rate,
           count(*) filter (where o.revision_count > 0 and o.revision_fault = 'writer')::int as writer_fault_revisions,
           count(*) filter (where o.complaint)::int as complaints,
           count(*) filter (where o.failed)::int as failed,
           round(avg(o.ai_score) filter (where o.ai_score is not null), 2) as avg_ai_score,
           count(*) filter (where o.satisfaction = 'high')::int as satisfaction_high,
           count(*) filter (where o.satisfaction = 'neutral')::int as satisfaction_neutral,
           count(*) filter (where o.satisfaction = 'low')::int as satisfaction_low
    from work_outcome o
    join work_item wi on wi.id = o.work_item_id
    where wi.doer_party_id is not null
    group by wi.org_id, wi.doer_party_id
  )
  select org_id, writer_party_id, jobs,
         on_time_measured, on_time_yes,
         round(on_time_yes::numeric / nullif(on_time_measured, 0), 2) as on_time_rate,
         avg_days_late, revision_rate, writer_fault_revisions, complaints, failed,
         round(failed::numeric / nullif(jobs, 0), 2) as fail_rate,
         avg_ai_score, satisfaction_high, satisfaction_neutral, satisfaction_low,
         round(
           greatest(0, least(1,
             coalesce(on_time_yes::numeric / nullif(on_time_measured, 0), 1)
             - (0.4 * coalesce(writer_fault_revisions::numeric / nullif(jobs, 0), 0)
                + 0.4 * coalesce(complaints::numeric / nullif(jobs, 0), 0)
                + 0.5 * coalesce(failed::numeric / nullif(jobs, 0), 0))
           )) * 100, 2) as reliability_score
  from raw;

-- ── expense totals (aggregate by month/category/cost-bearer; no receipt detail) ─
create or replace view analytics.expense_totals as
  select org_id,
         date_trunc('month', incurred_at)::date as month,
         category, cost_bearer,
         round(sum(amount)::numeric, 2) as total,
         count(*)::int as items
  from expense
  where archived_at is null
  group by org_id, date_trunc('month', incurred_at), category, cost_bearer;

-- ── a party's own two-way position (mirrors BalanceService; party-scoped) ─────
create or replace view analytics.party_balance as
  with earn_owed as (
    select org_id, to_party_id as party_id, sum(amount) as v
    from leg where to_party_id is not null group by org_id, to_party_id
  ),
  earn_paid as (
    select org_id, writer_party_id as party_id, sum(amount) as v
    from payment_allocation where writer_party_id is not null group by org_id, writer_party_id
  ),
  ch_owed as (
    select org_id, party_id, sum(amount) as v from charge group by org_id, party_id
  ),
  ch_paid as (
    select c.org_id, c.party_id, sum(pa.amount) as v
    from payment_allocation pa join charge c on c.id = pa.charge_id
    group by c.org_id, c.party_id
  ),
  parties as (
    select org_id, party_id from earn_owed
    union select org_id, party_id from earn_paid
    union select org_id, party_id from ch_owed
  )
  select pr.org_id, pr.party_id,
         coalesce(eo.v, 0) as earnings_owed,
         coalesce(ep.v, 0) as earnings_paid,
         coalesce(eo.v, 0) - coalesce(ep.v, 0) as earnings_outstanding,
         coalesce(co.v, 0) as charges_owed,
         coalesce(cp.v, 0) as charges_paid,
         coalesce(co.v, 0) - coalesce(cp.v, 0) as charges_outstanding,
         (coalesce(eo.v, 0) - coalesce(ep.v, 0)) - (coalesce(co.v, 0) - coalesce(cp.v, 0)) as net
  from parties pr
  left join earn_owed eo on eo.org_id = pr.org_id and eo.party_id = pr.party_id
  left join earn_paid ep on ep.org_id = pr.org_id and ep.party_id = pr.party_id
  left join ch_owed co on co.org_id = pr.org_id and co.party_id = pr.party_id
  left join ch_paid cp on cp.org_id = pr.org_id and cp.party_id = pr.party_id;

-- ============================================================================
-- Grants: analytics_ro may read ONLY the analytics views — nothing else.
-- ============================================================================
grant usage on schema analytics to analytics_ro;
grant select on all tables in schema analytics to analytics_ro;
alter default privileges in schema analytics grant select on tables to analytics_ro;

-- Defense in depth: analytics_ro gets NOTHING in the public schema — no base
-- table (leg, payment, invoice, charge, pf_*, deal_term, vault, …) and no
-- sequence. (A no-op, since it was never granted any, but it makes the boundary
-- explicit and survives a future stray grant on an existing object.)
revoke all on all tables in schema public from analytics_ro;
revoke all on all sequences in schema public from analytics_ro;
