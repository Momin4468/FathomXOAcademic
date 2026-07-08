-- ============================================================================
-- 0038_leg_reprice.sql — a first-class post-leg price-correction primitive
-- (BUSINESS_MODEL_AUDIT P1 item 6). Legs are append-only (no edit); a re-price
-- posts a single DELTA leg = new − current for a from→to pair. The admin doing
-- the correction isn't a party to every leg, so leg RLS would hide the current
-- sum — this SECURITY DEFINER returns it (org-scoped only, aggregate; same
-- trust model as job_pnl / party_job_earnings, reached only via the
-- work:approve-gated reprice endpoint). No amount stored beyond the legs
-- themselves; the correction is an ordinary append.
-- ============================================================================

create or replace function leg_pair_sum(p_work_item uuid, p_from uuid, p_to uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(amount), 0)
  from leg
  where org_id = app_current_org()
    and work_item_id = p_work_item
    and from_party_id is not distinct from p_from
    and to_party_id is not distinct from p_to
$$;

revoke all on function leg_pair_sum(uuid, uuid, uuid) from public;
grant execute on function leg_pair_sum(uuid, uuid, uuid) to app_user;
