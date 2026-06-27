-- ============================================================================
-- 0010_billing_fixes.sql — Module 5 review fixes (additive).
--  - payment.reverses_payment_id: makes "already reversed?" checkable so a
--    payment can't be double-reversed (B2).
--  - charge_summary(): a SECURITY DEFINER lookup so billing ops can validate a
--    charge (org/party/amount/already-reversed) even though charge is party-RLS
--    and the admin isn't the party — used by reverseCharge (B3) and allocate's
--    cross-org guard (B4). Returns only what's needed to validate; EXECUTE to
--    app_user only.
-- ============================================================================

alter table payment
  add column if not exists reverses_payment_id uuid references payment(id);

create or replace function charge_summary(p_charge_id uuid)
returns table (org_id uuid, party_id uuid, amount numeric, reversed boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.org_id, c.party_id, c.amount,
         exists (select 1 from charge r where r.reverses_charge_id = c.id) as reversed
  from charge c
  where c.id = p_charge_id
$$;

revoke all on function charge_summary(uuid) from public;
grant execute on function charge_summary(uuid) to app_user;
