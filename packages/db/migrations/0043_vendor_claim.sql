-- ============================================================================
-- 0043_vendor_claim.sql — vendor self-service invoicing surface (BUSINESS_MODEL
-- AUDIT item 13). The leg-visibility scoping already lets a vendor see their own
-- handoff legs; this adds the missing SUBMIT-AN-INVOICE surface. A vendor is a
-- LIGHT business-plane user (a user_account on their vendor party + the Vendor
-- role) — no new login plane.
--
-- vendor_claim is a propose→confirm GOVERNANCE record (CLAUDE.md rule 8): a vendor
-- submits a proposed invoice; an admin approves or rejects. Approval does NOT
-- auto-post a leg — leg.work_item_id is NOT NULL and the chain seq is leg-RLS
-- scoped (the approving admin isn't a party to it), so the admin posts the actual
-- business→vendor leg in the job flow where they hold full chain context. The
-- claim is the vendor's ASK + the admin's decision; the money stays in the leg
-- ledger, correct and unconflated.
-- ============================================================================

create table if not exists vendor_claim (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  vendor_party_id uuid not null references party(id),
  work_item_id uuid references work_item(id),   -- the job it's for (optional)
  amount numeric(14,2) not null,
  note text,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  created_by uuid references user_account(id),   -- the submitting vendor's user id
  decided_by uuid references user_account(id),   -- the admin who approved/rejected
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
-- NOTE (visibility): vendor_claim is OPERATIONAL governance state (a vendor's own
-- proposed invoice amount) — NOT a money leg/price (those stay leg-RLS + definer
-- protected). A vendor's own-claim scoping is enforced SERVER-SIDE in the service
-- (recipient = principal.partyId), under tenant-RLS, and proven by a cross-vendor
-- isolation test — the same pattern as task/notification. A party-scoped RLS SELECT
-- policy would break the business-admin review queue (admins are not the vendor
-- party and are not superadmin) without adding definer functions; kept light by
-- design (audit item 13 = "the mechanism exists, only the UI is missing").
create index if not exists vendor_claim_org_idx on vendor_claim (org_id, status);
create index if not exists vendor_claim_vendor_idx on vendor_claim (org_id, vendor_party_id);

-- Operational state (not the money ledger): tenant-RLS, select/insert/update.
alter table vendor_claim enable row level security;
alter table vendor_claim force row level security;
create policy tenant_isolation on vendor_claim for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
grant select, insert, update on vendor_claim to app_user;

-- ─── Permissions (module 'vendor') ────────────────────────────────────────────
-- The Vendor role (…a8) sees + submits its own; admins/superadmins view + approve.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a8', 'vendor', a
from unnest(array['view','create']) a
on conflict do nothing;

insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r, 'vendor', a
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3'
]::uuid[]) r
cross join unnest(array['view','approve']) a
on conflict do nothing;
