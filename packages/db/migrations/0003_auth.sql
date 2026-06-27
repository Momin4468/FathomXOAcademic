-- ============================================================================
-- 0003_auth.sql — Authentication support for Module 0 depth.
--
--  1. app_auth_lookup(email): the ONLY sanctioned RLS bypass. Login must read
--     user_account by email before any org context exists; RLS would block that.
--     A SECURITY DEFINER function owned by the schema owner runs with the owner's
--     rights (bypassing RLS) but exposes ONLY auth columns for the one matching
--     email. The app keeps connecting as the non-owner app_user.
--
--  2. auth_refresh_token: hashed, per-device refresh tokens with a sliding 10-day
--     expiry (re-set on every use) and server-side revocation (logout).
-- ============================================================================

-- ─── Credential lookup (narrow, owner-rights, audited at the app layer) ──────
create or replace function app_auth_lookup(p_email citext)
returns table (
  id uuid,
  org_id uuid,
  party_id uuid,
  password_hash text,
  status text,
  twofa_secret text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.org_id, u.party_id, u.password_hash, u.status, u.twofa_secret
  from user_account u
  where u.email = p_email
$$;

-- Only the app role may call it; never the world.
revoke all on function app_auth_lookup(citext) from public;
grant execute on function app_auth_lookup(citext) to app_user;

-- ─── Refresh tokens (hashed; one row per device; sliding expiry) ─────────────
create table auth_refresh_token (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  user_id uuid not null references user_account(id),
  token_hash text not null,            -- sha256 of the opaque refresh JWT string
  device_label text,
  expires_at timestamptz not null,     -- set to now()+10d on issue and each refresh
  revoked_at timestamptz,              -- set by logout / rotation (server-side)
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_refresh_token_user_idx on auth_refresh_token (org_id, user_id);
create index auth_refresh_token_hash_idx on auth_refresh_token (org_id, token_hash);

-- RLS: tenant isolation (same pattern as 0001_rls.sql).
alter table auth_refresh_token enable row level security;
alter table auth_refresh_token force row level security;
create policy tenant_isolation on auth_refresh_token for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());

-- Mutable-but-never-hard-deleted (update = rotate/revoke).
grant select, insert, update on auth_refresh_token to app_user;
