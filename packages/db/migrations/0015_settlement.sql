-- ============================================================================
-- 0015_settlement.sql — Settlement layer (DESIGN_SPEC §4.4, §3).
-- The Emon↔Momin shared money picture: dated partner transfers + the SHARED
-- profit pool computed from legs, netting to who-owes-whom — WITHOUT either
-- partner ever seeing the other's private legs/margins.
--
--  - settlement_transfer: append-only, dated partner→partner transfers. Visible
--    to the two named partners (and System SuperAdmin) only — leg-style RLS.
--  - settlement_legs(): SECURITY DEFINER. Returns, per shared job, ONLY the
--    shared pool (downstream-node margin) + the partner pair + job date — NEVER
--    the upstream's private client leg. Caller-guarded to the two partners.
--  - party_job_earnings(): SECURITY DEFINER. A party's earnings on one job (sum
--    of legs TO them) so the platform-fee base can be computed by an admin who
--    isn't a party to those legs.
-- ============================================================================

-- ── settlement_transfer (dated partner transfers; append-only) ──────────────
create table if not exists settlement_transfer (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  from_party_id uuid not null references party(id),
  to_party_id uuid not null references party(id),
  amount numeric(14,2) not null,
  transferred_at date not null,
  medium text,
  note text,
  reverses_transfer_id uuid references settlement_transfer(id),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists settlement_transfer_org_idx  on settlement_transfer (org_id);
create index if not exists settlement_transfer_from_idx  on settlement_transfer (from_party_id);
create index if not exists settlement_transfer_to_idx    on settlement_transfer (to_party_id);

-- RLS: a transfer is visible to the two parties on it (or System SuperAdmin).
alter table settlement_transfer enable row level security;
alter table settlement_transfer force row level security;
create policy settlement_transfer_visibility on settlement_transfer for all
  using (
    org_id = app_current_org()
    and (app_is_superadmin() or app_current_party() in (from_party_id, to_party_id))
  )
  with check (org_id = app_current_org());

-- Append-only: insert + select only (corrections are reversing entries).
grant select, insert on settlement_transfer to app_user;

-- ── settlement_legs(): the shared pool per job (RLS-bypassing, but pool-only) ─
-- For each inter-partner handoff leg (from & to both in {a,b}), the DOWNSTREAM
-- (to) partner holds the pool = handoff − Σ(downstream's legs out to non-{a,b}
-- parties, i.e. the writer cost). The upstream's private client leg is never
-- read out. Emits rows only to one of the two partners (or System SuperAdmin).
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
         (h.amount - coalesce(w.writer_cost, 0)) as pool
  from leg h
  join work_item wi on wi.id = h.work_item_id
  left join lateral (
    select coalesce(sum(o.amount), 0) as writer_cost
    from leg o
    where o.work_item_id = h.work_item_id
      and o.from_party_id = h.to_party_id
      and (o.to_party_id is null or o.to_party_id not in (p_a, p_b))
  ) w on true
  where h.org_id = app_current_org()
    and h.from_party_id in (p_a, p_b)
    and h.to_party_id in (p_a, p_b)
    and h.from_party_id <> h.to_party_id
    and (app_is_superadmin() or app_current_party() in (p_a, p_b))
$$;

revoke all on function settlement_legs(uuid, uuid) from public;
grant execute on function settlement_legs(uuid, uuid) to app_user;

-- ── party_job_earnings(): a party's earnings on one job (fee base) ──────────
create or replace function party_job_earnings(p_party uuid, p_work_item uuid)
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
    and to_party_id = p_party
$$;

revoke all on function party_job_earnings(uuid, uuid) from public;
grant execute on function party_job_earnings(uuid, uuid) to app_user;

-- ── platform_fee_exists(): idempotency guard for the platform-fee apply ──────
-- charge is party-RLS and the admin isn't the party, so a normal SELECT can't
-- see it. This definer answers "is there already a live platform_fee charge for
-- this party+job?" so the apply action can refuse a double-charge.
create or replace function platform_fee_exists(p_party uuid, p_work_item uuid)
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
      and c.category = 'platform_fee'
      and c.amount > 0
      and not exists (select 1 from charge r where r.reverses_charge_id = c.id)
  )
$$;

revoke all on function platform_fee_exists(uuid, uuid) from public;
grant execute on function platform_fee_exists(uuid, uuid) to app_user;
