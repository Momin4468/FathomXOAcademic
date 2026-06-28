-- ============================================================================
-- 0022_resit.sql — Resit / fail handling (DESIGN_SPEC §3, §6, §8).
-- A failed job is redone ON THE SAME work_item: a controlled reopen (work-state
-- redo), the resit (second) writer as an extra line + leg, the original writer's
-- pay reduced via a reversing leg and/or an `adjustment` clawback charge, and the
-- client optionally re-billed to 0. A failed job may be a NET LOSS — reported
-- truthfully from a DERIVED job P&L (legs + clawback charges + rework), never
-- stored. This migration adds only the thin pieces:
--   1. work_outcome.resit  — marks that a resit was performed (queryable).
--   2. party_earnings_outstanding() — owed−paid for a party, so the resit can
--      auto-pick reversing-leg (not-yet-paid) vs clawback-charge (already-paid).
--   3. job_pnl() — revenue / writer_cost / clawback for the truthful loss read
--      model (the admin isn't a party to the legs/charges).
-- ============================================================================

-- 1. Resit marker on the outcome.
alter table work_outcome add column if not exists resit boolean not null default false;

-- 2. party_earnings_outstanding(): owed (legs to party) − paid (allocations to
-- party), org-scoped. Drives the resit reduction split (reversing leg vs clawback
-- charge). The admin isn't the writer, so a normal SELECT can't see their legs.
create or replace function party_earnings_outstanding(p_party uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((select sum(amount) from leg
              where org_id = app_current_org() and to_party_id = p_party), 0)
    -
    coalesce((select sum(amount) from payment_allocation
              where org_id = app_current_org() and writer_party_id = p_party), 0)
$$;

revoke all on function party_earnings_outstanding(uuid) from public;
grant execute on function party_earnings_outstanding(uuid) to app_user;

-- 3. job_pnl(): the truthful job economics for the loss read model.
--   revenue     = Σ legs FROM the client (source_party) — nets to 0 after a
--                 client-reversal leg (zeroClientBilling).
--   writer_cost = Σ legs TO a writer-typed party, EXCLUDING the client→partner
--                 revenue handoff (from = source_party). Excluding the handoff is
--                 what stops a multi-hat partner (e.g. Momin {partner,writer})
--                 receiving the client payment from being miscounted as writer
--                 cost. Covers BOTH writers; nets down a reversing writer leg.
--   clawback    = Σ adjustment charges on the job (party→business recovery; a
--                 clawback reduces the loss).
-- net loss = revenue − writer_cost + clawback − rework_cost (rework added in TS).
-- Org-scoped; reachable only via the money-gated job detail / approve-gated resit
-- paths — same trust model as job_money / party_job_earnings (0015/0021).
create or replace function job_pnl(p_work_item uuid)
returns table (revenue numeric, writer_cost numeric, clawback numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((
      select sum(l.amount) from leg l join work_item wi on wi.id = l.work_item_id
      where l.work_item_id = p_work_item and l.org_id = app_current_org()
        and wi.source_party_id is not null and l.from_party_id = wi.source_party_id
    ), 0) as revenue,
    coalesce((
      select sum(l.amount) from leg l
      join party p on p.id = l.to_party_id
      join work_item wi on wi.id = l.work_item_id
      where l.work_item_id = p_work_item and l.org_id = app_current_org()
        and p.party_type @> array['writer']::text[]
        and (wi.source_party_id is null or l.from_party_id is distinct from wi.source_party_id)
    ), 0) as writer_cost,
    coalesce((
      select sum(c.amount) from charge c
      where c.work_item_id = p_work_item and c.org_id = app_current_org()
        and c.category = 'adjustment'
    ), 0) as clawback
$$;

revoke all on function job_pnl(uuid) from public;
grant execute on function job_pnl(uuid) to app_user;
