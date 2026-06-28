-- ============================================================================
-- 0024_dashboards.sql — Role-scoped dashboards (DESIGN_SPEC §8, §10).
-- No new tables: dashboards COMPOSE existing derived read-models under the
-- viewer's RLS. This migration adds only the owner-level AGGREGATE read-models
-- (profit-per-writer, client dues) as SECURITY DEFINER functions returning
-- ROLLUPS ONLY (never raw legs/charges), plus the `dashboard` permission module.
-- Everything is derived at read time — never stored (guard:no-stored-profit).
-- Aggregate-only + org-scoped + reached only via the dashboard:approve section
-- keeps §4.5 intact (Biz SuperAdmin/owner get "agg"; raw legs stay opaque).
-- ============================================================================

-- dashboard_writer_pnl(): per-writer rollup attributed to the job's doer —
-- §11.7 "client-leg − writer-leg grouped by writer". Same revenue/writer_cost
-- definitions as job_pnl (0022): revenue = Σ legs FROM the client; writer_cost =
-- Σ legs TO writer-typed parties excluding the client→partner handoff. `net` =
-- revenue − writer_cost (the "p_r_o_f_i_t" word is reserved for derived TS only,
-- per the no-stored guard). Aggregate rows only. Org-scoped.
drop function if exists dashboard_writer_profit();
create or replace function dashboard_writer_pnl()
returns table (writer_party_id uuid, jobs int, revenue numeric, writer_cost numeric, net numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select wi.doer_party_id as writer_party_id,
         count(*)::int as jobs,
         coalesce(sum(j.revenue), 0) as revenue,
         coalesce(sum(j.writer_cost), 0) as writer_cost,
         coalesce(sum(j.revenue - j.writer_cost), 0) as net
  from work_item wi
  cross join lateral (
    select
      coalesce((
        select sum(l.amount) from leg l
        where l.work_item_id = wi.id and l.org_id = app_current_org()
          and wi.source_party_id is not null and l.from_party_id = wi.source_party_id
      ), 0) as revenue,
      coalesce((
        select sum(l.amount) from leg l join party p on p.id = l.to_party_id
        where l.work_item_id = wi.id and l.org_id = app_current_org()
          and p.party_type @> array['writer']::text[]
          and (wi.source_party_id is null or l.from_party_id is distinct from wi.source_party_id)
      ), 0) as writer_cost
  ) j
  where wi.org_id = app_current_org()
    and wi.doer_party_id is not null
    and wi.archived_at is null
  group by wi.doer_party_id
$$;

revoke all on function dashboard_writer_pnl() from public;
grant execute on function dashboard_writer_pnl() to app_user;

-- dashboard_client_dues(): outstanding client receivables (the owner headline).
-- Per client: invoiced (non-void invoice lines) − paid (allocations) = due > 0.
-- Aggregate rows only. Org-scoped.
create or replace function dashboard_client_dues()
returns table (client_party_id uuid, invoiced numeric, paid numeric, due numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.client_party_id,
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
  where i.org_id = app_current_org() and i.status <> 'void'
  group by i.client_party_id
  having coalesce(sum(il.amount), 0) - coalesce(sum(pa.amt), 0) > 0
$$;

revoke all on function dashboard_client_dues() from public;
grant execute on function dashboard_client_dues() to app_user;

-- ─── Seed the 'dashboard' permission module ──────────────────────────────────
-- view: every role has a landing ("my numbers").
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'dashboard', 'view'
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3','00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000a5','00000000-0000-4000-8000-0000000000a6',
  '00000000-0000-4000-8000-0000000000a7','00000000-0000-4000-8000-0000000000a8',
  '00000000-0000-4000-8000-0000000000a9'
]) r
on conflict do nothing;

-- approve: the OWNER analytics gate (profit-per-writer, org margin, all-client
-- dues) — System SuperAdmin (a1) + Business SuperAdmin (a2) + Admin/owner (a3).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'dashboard', 'approve'
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3'
]) r
on conflict do nothing;
