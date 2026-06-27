-- ============================================================================
-- 0016_platform_fee_unique.sql — backstop the platform-fee idempotency guard.
-- applyPlatformFee() does a check-then-insert (platform_fee_exists → insert),
-- which can race under concurrency. This partial unique index makes "one live
-- platform_fee charge per (party, job)" a DB invariant: a concurrent second
-- insert fails atomically rather than double-charging. Reversals (negative
-- amount / reverses_charge_id set) are excluded, so a reversed fee can be
-- re-applied.
-- ============================================================================

create unique index if not exists charge_platform_fee_once
  on charge (org_id, party_id, work_item_id)
  where category = 'platform_fee' and reverses_charge_id is null and amount > 0;
