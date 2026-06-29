-- ============================================================================
-- 0032_channels_profit_share.sql — Channels + source-driven routing + N-way
-- profit-share (DESIGN_SPEC §3, §4.4; module 17).
--
-- Almost everything reuses the existing engine. This migration adds only:
--   1. channel — a thin config row over a party tagged 'channel', so a job's
--      source_party_id can point at an admin-creatable Web/Facebook/… source.
--   2. the 'channels' permission module.
--   3. profit_share_pool() — the admin-visible money bases for a job's pool
--      (revenue / writer cost / source), so deriveProfitShares can divide it.
--   4. my_profit_share() — a caller-guarded read so a sharer sees ONLY their own
--      per-job cut (never the pool, never another sharer's cut). §4.4 opacity.
--   5. charge_exists() — generalizes platform_fee_exists() to any charge category
--      (writer_commission reuses the same idempotent check-then-insert + a partial
--      unique index backstop).
--
-- NO new deal_term column: profit_share / writer_commission reuse `basis` (0021).
-- A profit_share term keys on the BENEFICIARY (to_party_id; from_party_id = NULL
-- = the business pays it). Source routing is the new applies_to kind 'source:<id>'
-- resolved in @business-os/shared. The doer-conditional channel scheme falls out
-- of the leg chain (a doer is a node; a non-doer partner is not), so there is no
-- doer dimension here. NOTHING in the binary settlement (0015) changes.
-- ============================================================================

-- ── 1. channel (config over a party tagged 'channel') ───────────────────────
create table if not exists channel (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  party_id uuid not null references party(id),        -- the channel-as-party (party_type @> {channel})
  controller_party_id uuid references party(id),       -- null = business | Momin | Emon | any person
  medium text not null,                                -- 'web' | 'facebook' | free text (no enum → no code change)
  is_active boolean not null default true,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create unique index if not exists channel_party_ux on channel (party_id);
create index if not exists channel_org_idx on channel (org_id);

-- Config (not an append-only money ledger): tenant-isolation RLS; update allowed.
-- Historical routing comes from dated deal_terms, NOT from controller_party_id
-- (that column only labels the current default residual owner for display).
alter table channel enable row level security;
alter table channel force row level security;
drop policy if exists channel_tenant_isolation on channel;
create policy channel_tenant_isolation on channel for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
grant select, insert, update on channel to app_user;

-- ── 2. 'channels' permission module ─────────────────────────────────────────
-- System SuperAdmin + Admin: all actions (create/tune channels + profit-share terms).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'channels', a
from unnest(array['00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a3']) r
cross join unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- Business SuperAdmin + Manager: view (read channels + profit-share attribution).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'channels', 'view'
from unnest(array['00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a4']) r
on conflict do nothing;

-- ── 3. profit_share_pool(): the admin-visible money bases for a job's pool ────
-- Mirrors job_money() (0021): an Admin is entitled to see money but is NOT a party
-- to the chain legs (no leg-bypass GUC), so a normal SELECT can't read the client
-- price. This definer returns the job's revenue (legs FROM the source), writer
-- cost (legs TO the doer), and the source party so deriveProfitShares (in the API)
-- can divide the post-writer pool among the sharers. Org-scoped. Gate at the
-- controller (channels:view / billing:view) — NEVER expose to a non-money role.
create or replace function profit_share_pool(p_work_item uuid)
returns table (revenue numeric, writer_cost numeric, source_party_id uuid)
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
      select sum(l.amount) from leg l join work_item wi on wi.id = l.work_item_id
      where l.work_item_id = p_work_item and l.org_id = app_current_org()
        and wi.doer_party_id is not null and l.to_party_id = wi.doer_party_id
    ), 0) as writer_cost,
    (select wi.source_party_id from work_item wi where wi.id = p_work_item and wi.org_id = app_current_org())
$$;

revoke all on function profit_share_pool(uuid) from public;
grant execute on function profit_share_pool(uuid) to app_user;

-- ── 4. my_profit_share(): a sharer's OWN per-job cut (opacity-preserving) ─────
-- §4.4: a sharer sees only their own slice. This definer resolves the calling
-- party's winning profit_share term per job (effective-dated; applies_to default
-- or source:<channelPartyId>, most-specific wins — mirrors resolveProfitShareTerm
-- in @business-os/shared) and returns ONLY the resulting amount — never the pool,
-- never another sharer's cut, never the chain. Caller-guarded to the party itself
-- (or System SuperAdmin). Client/jobtype-scoped profit_share terms are an admin-
-- panel concern (computed via deriveProfitShares); the self-view resolves the
-- channel-routing scopes (default + source).
-- Returns a `scope` ('default' | 'source') so the self-view can apply §D: a
-- channel/source-scoped cut is safe to show per-job (its base is that channel's
-- margin), but a default net-profit dividend (a silent investor's whole-business
-- share) must be shown AGGREGATE-ONLY — the API sums it and never lists per-job
-- rows, so an individual private-client job's margin can't be isolated.
drop function if exists my_profit_share(uuid);
create or replace function my_profit_share(p_party uuid)
returns table (work_item_id uuid, job_date date, amount numeric, scope text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with jobs as (
    select wi.id as work_item_id,
           (wi.created_at)::date as job_date,
           wi.source_party_id,
           coalesce((
             select sum(l.amount) from leg l
             where l.work_item_id = wi.id and l.org_id = app_current_org()
               and wi.source_party_id is not null and l.from_party_id = wi.source_party_id
           ), 0)
           - coalesce((
             select sum(l.amount) from leg l
             where l.work_item_id = wi.id and l.org_id = app_current_org()
               and wi.doer_party_id is not null and l.to_party_id = wi.doer_party_id
           ), 0) as pool
    from work_item wi
    where wi.org_id = app_current_org()
  ),
  winning as (
    select j.work_item_id, j.job_date, j.pool, t.basis, t.value, t.applies_to
    from jobs j
    join lateral (
      select dt.basis, dt.value, dt.applies_to
      from deal_term dt
      where dt.org_id = app_current_org()
        and dt.term_type = 'profit_share'
        and dt.to_party_id = p_party
        and dt.effective_from <= j.job_date
        and (dt.effective_to is null or j.job_date < dt.effective_to)
        and (
          dt.applies_to = 'default'
          or (dt.applies_to like 'source:%'
              and j.source_party_id is not null
              and substring(dt.applies_to from 8) = j.source_party_id::text)
        )
      order by
        case when dt.applies_to like 'source:%' then 3 else 1 end desc,
        dt.effective_from desc,
        dt.created_at desc
      limit 1
    ) t on true
  )
  select work_item_id, job_date,
         round(case when basis = 'fixed' then value else pool * value / 100 end, 2) as amount,
         case when applies_to like 'source:%' then 'source' else 'default' end as scope
  from winning
  where app_is_superadmin() or app_current_party() = p_party
$$;

revoke all on function my_profit_share(uuid) from public;
grant execute on function my_profit_share(uuid) to app_user;

-- ── 5. charge_exists(): generalize the platform-fee idempotency guard ─────────
-- Same shape as platform_fee_exists (0015) but parameterized by category, so
-- writer_commission (and any future charge category) reuses one idempotent guard.
-- Returns ONLY a boolean (never an amount). A fully-reversed charge (net 0) is
-- false so a fresh charge is allowed.
create or replace function charge_exists(p_party uuid, p_work_item uuid, p_category text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from charge c
    where c.org_id = app_current_org()
      and c.party_id = p_party
      and c.work_item_id = p_work_item
      and c.category = p_category
      and c.amount > 0
      and not exists (select 1 from charge r where r.reverses_charge_id = c.id)
  )
$$;

revoke all on function charge_exists(uuid, uuid, text) from public;
grant execute on function charge_exists(uuid, uuid, text) to app_user;

-- Backstop the writer_commission idempotency under concurrency (mirrors 0016's
-- platform_fee index): one live writer_commission charge per (party, job).
create unique index if not exists charge_writer_commission_once
  on charge (org_id, party_id, work_item_id)
  where category = 'writer_commission' and reverses_charge_id is null and amount > 0;
