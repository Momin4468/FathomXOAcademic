-- ============================================================================
-- 0051_roster_privacy.sql — Multi-admin row privacy (DECISIONS 2026-07-17).
--
-- Multiple admins share ONE org but run separate books of business (Emon, Momin,
-- Sabbir), each with their OWN clients / writers / vendors / jobs. Until now
-- work_item and party carried only org-wide `tenant_isolation`, so every admin
-- could read every other admin's client names + job titles (only contact was
-- masked and money was leg-scoped). The user's rule is "private by default,
-- shared on explicit grant" — a job/client is visible to the owning admin, to
-- the parties actually on it, and to anyone it was explicitly SHARED with (which
-- a cross-admin hand-off does). Money opacity (leg RLS) is unchanged.
--
-- Mechanism, mirroring the credential_vault per-item ACL (0018):
--   • owner_party_id on work_item + party  = the owning admin (book of business)
--   • roster_grant                          = per-row ACL (share a job/client)
--   • owner/party/grant RLS on work_item    (replaces org-wide tenant_isolation)
--   • client-type-only RLS on party         (non-client parties stay org-wide so
--     name-resolution + pickers keep working; only the CLIENT roster is private)
-- ============================================================================

-- ── Ownership columns ───────────────────────────────────────────────────────
alter table work_item add column if not exists owner_party_id uuid references party(id);
alter table party     add column if not exists owner_party_id uuid references party(id);
create index if not exists work_item_owner_idx on work_item (owner_party_id);
create index if not exists party_owner_idx      on party (owner_party_id) where owner_party_id is not null;

-- ── roster_grant: per-row ACL (share a work_item or a client party) ─────────
create table if not exists roster_grant (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  subject_type text not null,                    -- 'work_item' | 'party'
  subject_id uuid not null,
  party_id uuid not null references party(id),   -- the grantee admin
  reason text,                                   -- e.g. 'handoff', 'shared'
  granted_by uuid, granted_at timestamptz not null default now(),
  revoked_by uuid, revoked_at timestamptz
);
create index if not exists roster_grant_subject_idx on roster_grant (subject_type, subject_id);
create index if not exists roster_grant_party_idx    on roster_grant (party_id);
-- One ACTIVE grant per (subject, party); a revoked grant can be re-granted.
create unique index if not exists roster_grant_active_uidx
  on roster_grant (subject_type, subject_id, party_id) where revoked_at is null;

-- A grantee sees their own grants (this is what makes the EXISTS in the
-- work_item / party policies below resolve).
alter table roster_grant enable row level security;
alter table roster_grant force row level security;
create policy roster_grant_visibility on roster_grant for all
  using (
    org_id = app_current_org()
    and (app_is_superadmin() or app_current_party() = party_id)
  )
  with check (org_id = app_current_org());
-- Grant creation is owner-gated in the service; the app role may INSERT + SELECT
-- but NOT UPDATE/DELETE — so a grantee can never un-revoke themselves (revocation
-- goes through the admin/definer path, like credential_share, 0018). Append-only.
grant select, insert on roster_grant to app_user;

-- ── work_item: owner / on-the-job / granted (replaces org-wide isolation) ────
-- Visible if SuperAdmin, OR the caller's party is the owner / source / doer /
-- client, OR the row was explicitly granted to them. INSERT keeps the plain
-- tenant check (an admin creates a row they then own). work.service.list relies
-- purely on this policy for its row set, so every board/list/dashboard scopes
-- automatically. A middle admin in a cross-admin chain is NOT source/doer/client
-- (only on legs) — the hand-off grant is what lets them see the parent job.
drop policy if exists tenant_isolation on work_item;
create policy work_item_visibility on work_item for all
  using (
    org_id = app_current_org()
    and (
      app_is_superadmin()
      or app_current_party() in (owner_party_id, source_party_id, doer_party_id, client_party_id)
      or exists (
        select 1 from roster_grant g
        where g.subject_type = 'work_item' and g.subject_id = work_item.id
          and g.party_id = app_current_party() and g.revoked_at is null
      )
    )
  )
  with check (org_id = app_current_org());

-- ── party: only the CLIENT roster is private; everything else stays org-wide ─
-- Non-client parties (writers/vendors/admins/referrers/channels) MUST stay
-- readable org-wide, else name-resolution joins (leg→party, doer name, invoice
-- client name) return null and the EntityPickers can't find an admin to hand off
-- to. A CLIENT is visible if SuperAdmin, the party itself (portal client sees its
-- own record), unowned/legacy (owner null = shared), owned by the caller, or
-- explicitly granted. Contact-masking stays as the field layer on top of this.
drop policy if exists tenant_isolation on party;
create policy party_visibility on party for all
  using (
    org_id = app_current_org()
    and (
      app_is_superadmin()
      or not (party_type @> array['client']::text[])   -- not a client at all → org-wide
      -- a client who is ALSO a colleague (writer/vendor/partner/…) stays visible, so
      -- multi-hat name-resolution + pickers don't break (CLAUDE.md §9).
      or (party_type && array['writer','vendor','partner','referrer','employee','channel']::text[])
      or id = app_current_party()                       -- a party always sees itself
      or owner_party_id is null                          -- unowned/legacy client = shared
      or owner_party_id = app_current_party()            -- my client
      or exists (
        select 1 from roster_grant g
        where g.subject_type = 'party' and g.subject_id = party.id
          and g.party_id = app_current_party() and g.revoked_at is null
      )
    )
  )
  with check (org_id = app_current_org());

-- ── Money tables follow the client's OWNERSHIP (CLAUDE.md §3.2/§4) ────────────
-- Privatizing party/work_item is not enough: invoice_line.amount IS the real
-- client price and invoice/payment reference the now-hidden client, so a peer
-- admin could still read another admin's client price via billing. Scope these to
-- the client's OWNER/GRANT — NOT to general party-row visibility, because the
-- party policy deliberately keeps multi-hat client-colleagues org-wide for
-- name-resolution, which would otherwise re-expose their price. The subquery is
-- still under party RLS (a pure hidden client → zero rows), AND the explicit
-- owner/grant predicate closes the multi-hat carve-out. A payout ('out' to a
-- writer/vendor — owner-null → shared) stays visible; a client 'in' payment is
-- owner-scoped. Client-portal reads use SECURITY DEFINER functions and are
-- unaffected. `pf_*` is a separate plane (no org_id) and is not touched.
drop policy if exists tenant_isolation on invoice;
create policy invoice_visibility on invoice for all
  using (
    org_id = app_current_org()
    and (
      app_is_superadmin()
      or exists (
        select 1 from party p
        where p.id = invoice.client_party_id
          and (
            p.owner_party_id is null
            or p.owner_party_id = app_current_party()
            or exists (select 1 from roster_grant g
                       where g.subject_type = 'party' and g.subject_id = p.id
                         and g.party_id = app_current_party() and g.revoked_at is null)
          )
      )
    )
  )
  with check (org_id = app_current_org());

drop policy if exists tenant_isolation on invoice_line;
create policy invoice_line_visibility on invoice_line for all
  using (
    org_id = app_current_org()
    and (app_is_superadmin() or exists (select 1 from invoice i where i.id = invoice_line.invoice_id))
  )
  with check (org_id = app_current_org());

drop policy if exists tenant_isolation on payment;
create policy payment_visibility on payment for all
  using (
    org_id = app_current_org()
    and (
      app_is_superadmin()
      or counterparty_party_id is null
      or exists (
        select 1 from party p
        where p.id = payment.counterparty_party_id
          and (
            p.owner_party_id is null
            or p.owner_party_id = app_current_party()
            or exists (select 1 from roster_grant g
                       where g.subject_type = 'party' and g.subject_id = p.id
                         and g.party_id = app_current_party() and g.revoked_at is null)
          )
      )
    )
  )
  with check (org_id = app_current_org());

drop policy if exists tenant_isolation on payment_allocation;
create policy payment_allocation_visibility on payment_allocation for all
  using (
    org_id = app_current_org()
    and (
      app_is_superadmin()
      or invoice_line_id is null
      or exists (select 1 from invoice_line il where il.id = payment_allocation.invoice_line_id)
    )
  )
  with check (org_id = app_current_org());

-- ── Backfill ownership from provenance (created_by → that user's party) ──────
-- Every existing job gets its logging admin as owner; every existing CLIENT gets
-- its creator as owner. Rows whose creator has no linked party stay null (= the
-- job is source/doer/client-scoped anyway; the client stays shared) — a safe,
-- non-destructive default (visible, never hidden).
update work_item w set owner_party_id = ua.party_id
  from user_account ua
  where ua.id = w.created_by and ua.party_id is not null and w.owner_party_id is null;
update party p set owner_party_id = ua.party_id
  from user_account ua
  where ua.id = p.created_by and ua.party_id is not null and p.owner_party_id is null
    and p.party_type @> array['client']::text[];
