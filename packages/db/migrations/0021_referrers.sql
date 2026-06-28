-- ============================================================================
-- 0021_referrers.sql — Referrers (DESIGN_SPEC §4, §8).
-- A referral is "another claimant leg, scoped like any other": an admin attaches
-- a leg from the business (from = null) TO a referrer party, and the existing
-- leg_visibility RLS (0001) scopes it so the referrer sees ONLY their own slice —
-- never the client price or the rest of the chain. Payout flows through the
-- existing earnings model (legs-to-you + payment_allocation). No new leg schema.
--
-- This migration adds only the thin pieces that referrals need:
--   1. deal_term.basis  — the referral agreement's basis (revenue|margin|fixed),
--      so "Mujib 10% of revenue" vs "10% of post-writer margin" vs a fixed amount
--      can all be captured as a referral_pct term and turned into a *suggestion*.
--   2. the 'referrers' permission module (admin manages + attaches; referrer reads
--      only their own).
--   3. referrer_works() — a SECURITY DEFINER read so a referrer login (no broad
--      work:view) can list the works that generated their income, caller-guarded
--      to themselves (pattern: settlement_legs / party_job_earnings, 0015).
-- A referral leg is identified by its deal_term being term_type='referral_pct'.
-- ============================================================================

-- 1. Referral agreement basis (nullable; only meaningful for referral_pct terms;
--    value = pct for revenue/margin, = amount for fixed).
alter table deal_term add column if not exists basis text;

-- 2. Seed the 'referrers' permission module.
-- System SuperAdmin + Admin: all actions (manage referrers/terms, attach, view).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'referrers', a
from unnest(array['00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a3']) r
cross join unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- Business SuperAdmin + Manager: view (read referral attribution).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'referrers', 'view'
from unnest(array['00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a4']) r
on conflict do nothing;

-- Referrer (a9): view only — their OWN slice (RLS + referrer_works enforce "own").
insert into permission (org_id, role_id, module, action) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a9', 'referrers', 'view')
on conflict do nothing;

-- 3. referrer_works(): the works a referrer earned on, WITHOUT granting work:view.
-- A referral leg = a leg to the referrer whose deal_term is a referral_pct term.
-- Caller-guarded: only the referrer themselves (or System SuperAdmin) may read.
-- Returns safe fields + the referrer's OWN referral amount — never the chain.
-- Client identity is permitted for a referrer's OWN referred works (spec §4.5).
create or replace function referrer_works(p_referrer uuid)
returns table (
  work_item_id uuid,
  title text,
  client_name text,
  referral_amount numeric,
  referral_at timestamptz,
  job_created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.work_item_id,
         wi.title,
         c.display_name as client_name,
         l.amount as referral_amount,
         l.created_at as referral_at,
         wi.created_at as job_created_at
  from leg l
  join deal_term dt on dt.id = l.deal_term_id and dt.term_type = 'referral_pct'
  join work_item wi on wi.id = l.work_item_id
  left join party c on c.id = wi.source_party_id
  where l.org_id = app_current_org()
    and l.to_party_id = p_referrer
    and (app_is_superadmin() or app_current_party() = p_referrer)
  order by l.created_at desc
$$;

revoke all on function referrer_works(uuid) from public;
grant execute on function referrer_works(uuid) to app_user;

-- job_money(): the admin-visible bases for a referral SUGGESTION. An Admin (role
-- a3) is NOT a party to the chain legs and lacks the leg-bypass GUC, so a normal
-- SELECT can't read the client price. This definer returns the job's revenue
-- (legs FROM the client) and writer cost (legs TO the doer) so the admin — who is
-- entitled to see money — can compute revenue/margin bases. Only reachable via the
-- referrers:approve-gated suggest endpoint. Org-scoped. NEVER exposed to a referrer.
create or replace function job_money(p_work_item uuid)
returns table (revenue numeric, writer_cost numeric)
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
    ), 0) as writer_cost
$$;

revoke all on function job_money(uuid) from public;
grant execute on function job_money(uuid) to app_user;

-- referral_exists(): the dup guard. The admin attaching isn't a party to the
-- (existing) referral leg, so a normal SELECT can't see it — this definer answers
-- "does a LIVE referral to this referrer already exist on this job?" so attach can
-- refuse a duplicate. It returns ONLY a boolean (never an amount — mirrors
-- platform_fee_exists, 0015): a fully-reversed referral (net 0) returns false so a
-- fresh attach is allowed. Org-scoped; exposes no money.
drop function if exists referral_net(uuid, uuid);
create or replace function referral_exists(p_work_item uuid, p_referrer uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(l.amount), 0) > 0
  from leg l
  join deal_term dt on dt.id = l.deal_term_id and dt.term_type = 'referral_pct'
  where l.org_id = app_current_org()
    and l.work_item_id = p_work_item
    and l.to_party_id = p_referrer
$$;

revoke all on function referral_exists(uuid, uuid) from public;
grant execute on function referral_exists(uuid, uuid) to app_user;
