-- ============================================================================
-- 0025_hardening.sql — deferred hardening (CLAUDE.md §3–4). No table changes.
--   1. file_owner_context() — resolve a file's owning entity (bypassing the
--      owners' RLS) so the app can enforce a KIND-AWARE per-file ACL on download.
--   2. settlement_legs() replaced — fold from=null "business cost" legs (referral)
--      into the pool so shared costs reduce it BEFORE the partner split (§4.4).
-- Both org-scoped; profit/pool stay DERIVED (never stored).
-- ============================================================================

-- 1. file_owner_context(): the server-side ownership facts for a file. Resolves
-- the indirect owner links (brief→work_item, proof→payment, receipt→expense),
-- bypassing those tables' RLS so an entitled admin (not a party to the row) can
-- still be authorized in the app layer. Returns NO row if the file isn't in the
-- caller's org (→ 404). Party/user ids are used server-side only, never returned
-- to the client. SAME trust model as settlement_legs/charge_summary.
create or replace function file_owner_context(p_file uuid)
returns table (
  kind text,
  doer_party uuid,
  source_party uuid,
  payment_counterparty uuid,
  expense_created_by uuid,
  file_created_by uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    f.kind,
    wi.doer_party_id      as doer_party,
    wi.source_party_id    as source_party,
    p.counterparty_party_id as payment_counterparty,
    e.created_by          as expense_created_by,
    f.created_by          as file_created_by
  from file_object f
  left join work_item wi    on wi.brief_file_id = f.id
  left join payment_proof pp on pp.file_object_id = f.id
  left join payment p       on p.id = pp.payment_id
  left join expense e       on e.receipt_file_id = f.id
  where f.id = p_file and f.org_id = app_current_org()
$$;

revoke all on function file_owner_context(uuid) from public;
grant execute on function file_owner_context(uuid) to app_user;

-- 2. settlement_legs(): the shared pool per job, now NET of from=null business
-- costs (referral legs). pool = handoff − downstream's writer cost − shared cost.
-- The shared_cost lateral sums legs on the job with from_party_id IS NULL (the
-- business bears them; e.g. a referral payout) so both partners' shares drop
-- proportionally before the split — never a stored figure (§4.4, §11).
create or replace function settlement_legs(p_a uuid, p_b uuid)
returns table (
  work_item_id uuid,
  job_date date,
  upstream_party uuid,
  downstream_party uuid,
  pool numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.work_item_id,
         (wi.created_at)::date as job_date,
         h.from_party_id as upstream_party,
         h.to_party_id as downstream_party,
         (h.amount - coalesce(w.writer_cost, 0) - coalesce(s.shared_cost, 0)) as pool
  from leg h
  join work_item wi on wi.id = h.work_item_id
  left join lateral (
    select coalesce(sum(o.amount), 0) as writer_cost
    from leg o
    where o.work_item_id = h.work_item_id
      and o.from_party_id = h.to_party_id
      and (o.to_party_id is null or o.to_party_id not in (p_a, p_b))
  ) w on true
  left join lateral (
    select coalesce(sum(o.amount), 0) as shared_cost
    from leg o
    where o.work_item_id = h.work_item_id
      and o.from_party_id is null
  ) s on true
  where h.org_id = app_current_org()
    and h.from_party_id in (p_a, p_b)
    and h.to_party_id in (p_a, p_b)
    and h.from_party_id <> h.to_party_id
    and (app_is_superadmin() or app_current_party() in (p_a, p_b))
$$;

revoke all on function settlement_legs(uuid, uuid) from public;
grant execute on function settlement_legs(uuid, uuid) to app_user;
