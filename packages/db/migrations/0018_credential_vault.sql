-- ============================================================================
-- 0018_credential_vault.sql — Module 8: credential vault (§8, CLAUDE.md §4).
-- A secrets-manager for tool accounts (AcademyCX, Subscheap) AND client-scoped
-- portal credentials. The secret bundle ({username,password,2FA-recovery,notes})
-- is AES-256-GCM encrypted by the app BEFORE insert — the DB only ever holds
-- ciphertext (never plaintext). Per-item sharing is enforced in RLS: a writer
-- sees ONLY items shared with them (zero rows otherwise), exactly like legs.
-- Admin management (list-all, who-has-access, revoke) goes through the sanctioned
-- SECURITY DEFINER pattern, reachable only from credential_vault:approve endpoints.
-- ============================================================================

-- ── credential_vault_item: encrypted metadata + secret ciphertext ───────────
create table credential_vault_item (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  name text not null,                          -- human label, e.g. "AcademyCX #2"
  type text not null,                          -- portal | google | github | aws | tool | other
  url text,                                    -- portal link
  client_party_id uuid references party(id),   -- the client it belongs to (null = our own tool account)
  secret_iv text not null,                     -- AES-256-GCM nonce (base64)
  secret_tag text not null,                    -- GCM auth tag (base64)
  secret_ciphertext text not null,             -- encrypted {username,password,totpRecovery,notes}
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index credential_vault_item_org_idx on credential_vault_item (org_id);

-- ── credential_share: per-item ACL (grant a specific party an item) ─────────
create table credential_share (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  credential_id uuid not null references credential_vault_item(id),
  party_id uuid not null references party(id),  -- the grantee (holder)
  granted_by uuid, granted_at timestamptz not null default now(),
  revoked_by uuid, revoked_at timestamptz
);
create index credential_share_cred_idx on credential_share (credential_id);
create index credential_share_party_idx on credential_share (party_id);
-- One ACTIVE share per (item, party); a revoked share can be re-granted.
create unique index credential_share_active_uidx
  on credential_share (credential_id, party_id) where revoked_at is null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- An item is visible ONLY to a party holding an active share (or System
-- SuperAdmin). A non-holder gets ZERO rows (structural opacity, like legs).
alter table credential_vault_item enable row level security;
alter table credential_vault_item force row level security;
create policy credential_item_visibility on credential_vault_item for all
  using (
    org_id = app_current_org()
    and (
      app_is_superadmin()
      or exists (
        select 1 from credential_share s
        where s.credential_id = credential_vault_item.id
          and s.party_id = app_current_party()
          and s.revoked_at is null
      )
    )
  )
  with check (org_id = app_current_org());

-- A grantee sees their own shares; admin manages via the definer functions below.
alter table credential_share enable row level security;
alter table credential_share force row level security;
create policy credential_share_visibility on credential_share for all
  using (
    org_id = app_current_org()
    and (app_is_superadmin() or app_current_party() = party_id)
  )
  with check (org_id = app_current_org());

-- Mutable-but-undeletable (items archive via archived_at; shares revoke via revoked_at).
grant select, insert, update on credential_vault_item to app_user;
grant select, insert, update on credential_share to app_user;

-- ── Manager path: SECURITY DEFINER (sanctioned RLS bypass; metadata only) ───
-- Called ONLY from credential_vault:approve endpoints. NEVER returns ciphertext.
create or replace function vault_manage_list()
returns table (
  id uuid, name text, type text, url text,
  client_party_id uuid, created_at timestamptz, share_count int
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select i.id, i.name, i.type, i.url, i.client_party_id, i.created_at,
         (select count(*)::int from credential_share s
            where s.credential_id = i.id and s.revoked_at is null) as share_count
  from credential_vault_item i
  where i.org_id = app_current_org() and i.archived_at is null
  order by i.created_at desc
$$;
revoke all on function vault_manage_list() from public;
grant execute on function vault_manage_list() to app_user;

create or replace function vault_manage_shares(p_item uuid)
returns table (party_id uuid, granted_at timestamptz, granted_by uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.party_id, s.granted_at, s.granted_by
  from credential_share s
  where s.credential_id = p_item and s.org_id = app_current_org() and s.revoked_at is null
  order by s.granted_at
$$;
revoke all on function vault_manage_shares(uuid) from public;
grant execute on function vault_manage_shares(uuid) to app_user;

-- Revoke any share (admin can't UPDATE the row under RLS since they're not the grantee).
create or replace function vault_revoke_share(p_share uuid, p_actor uuid)
returns table (credential_id uuid, party_id uuid)
language sql security definer set search_path = public, pg_temp
as $$
  update credential_share
     set revoked_at = now(), revoked_by = p_actor
   where id = p_share and org_id = app_current_org() and revoked_at is null
   returning credential_id, party_id
$$;
revoke all on function vault_revoke_share(uuid, uuid) from public;
grant execute on function vault_revoke_share(uuid, uuid) to app_user;

-- ── Seed the 'credential_vault' permission module ────────────────────────────
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'credential_vault', a
from unnest(array['view','create','edit','approve']) a
on conflict do nothing;

insert into permission (org_id, role_id, module, action) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'credential_vault', 'view')
on conflict do nothing;

insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', 'credential_vault', a
from unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- Writer: view only (sees/reveals only the items shared with them — RLS-enforced).
insert into permission (org_id, role_id, module, action) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a6', 'credential_vault', 'view')
on conflict do nothing;
