-- ============================================================================
-- 0042_advance_ledger.sql — business-plane loan/advance ledger (BUSINESS_MODEL
-- AUDIT P1 item 11; decided 2026-07-08, story §4 loan bullet + §5 item 8).
-- Advances/loans to writers, vendors, or ANY named person are a BUSINESS-side
-- concern (ordinary receivable/payable), NOT personal finance — the private PF
-- plane's pf_loan/pf_loan_event (0027) stays for an admin's own money. This ports
-- that proven shape to the business plane, org-scoped:
--   • the OUTSTANDING balance is DERIVED at read (principal ∓ Σ events), never
--     stored (CLAUDE.md §3.3 — a stored balance would trip the guard);
--   • events are APPEND-ONLY (select/insert only) — a correction is a reversing
--     event (same kind, negated), never an edit;
--   • the counterparty is an arbitrary party (provisional parties allowed).
-- DISJOINT from legs/invoices by design: this ledger never touches the leg chain
-- or settlement math — an outstanding advance is SURFACED next to a party's
-- balance, and a repayment-from-earnings is a manual repayment event.
-- ============================================================================

create table if not exists advance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  counterparty_party_id uuid not null references party(id),
  direction text not null check (direction in ('given', 'taken')),  -- given = we advanced them; taken = we owe them
  principal numeric(16,2) not null,
  currency text not null default 'BDT',
  started_on date not null,
  due_on date,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists advance_org_idx on advance (org_id);
create index if not exists advance_counterparty_idx on advance (org_id, counterparty_party_id);

create table if not exists advance_event (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  advance_id uuid not null references advance(id),
  kind text not null check (kind in ('disbursement', 'repayment', 'adjustment')),
  amount numeric(16,2) not null,
  occurred_on date not null,
  note text,
  reverses_id uuid references advance_event(id),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists advance_event_advance_idx on advance_event (org_id, advance_id);

-- ─── RLS: tenant isolation (mirror price_group 0039) ──────────────────────────
alter table advance enable row level security;
alter table advance force row level security;
create policy tenant_isolation on advance for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
-- Header is mutable config (soft-delete via archived_at): select/insert/update.
grant select, insert, update on advance to app_user;

alter table advance_event enable row level security;
alter table advance_event force row level security;
create policy tenant_isolation on advance_event for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
-- Append-only ledger: select/insert only — corrections are reversing events.
grant select, insert on advance_event to app_user;

-- ─── Permissions (module 'advances') ──────────────────────────────────────────
-- Money-holding admin ledger: view/create/approve for the admin/superadmin roles
-- (mirror the 0041 notifications seed). Roles are data (rule 9).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r, 'advances', a
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3'
]::uuid[]) r
cross join unnest(array['view','create','approve']) a
on conflict do nothing;
