-- ============================================================================
-- 0034_password_reset.sql — Self-service password reset for ALL THREE auth planes
-- (business user_account, PF pf_account, client_account). Each plane already has
-- login/refresh/logout/2FA but no "forgot password" recovery. This adds the
-- standard flow: request-reset → time-limited emailed token → set-new-password.
--
-- The reset token is created (request) and consumed (set-password) PRE-AUTH —
-- there is no session / RLS GUC context at either step — so the token table is
-- touched ONLY by SECURITY DEFINER functions, exactly like pf_link_token (0027):
-- RLS forced ON with NO policy and NO app_user grant, so app_user can't read or
-- write it directly. The token is sha256-HASHED at rest (the raw token lives only
-- in the email link), single-use (used_at), and expiring (expires_at).
--
-- bcrypt can't run in SQL, so the app hashes the NEW password and passes the hash
-- to the consume function. The consume function is atomic + owner-rights: it marks
-- the token used, sets the account's password_hash, REVOKES ALL of that account's
-- live refresh tokens (a reset kills every session — a leaked/old token can't
-- survive it), and writes a completion audit row. No enumeration: the API always
-- responds generically; the DB simply returns NULL when there's no live token.
-- ============================================================================

-- ─── password_reset_token: one shared, definer-only table (plane discriminator) ─
-- Touched ONLY by the SECURITY DEFINER functions below (mirror pf_link_token).
create table if not exists password_reset_token (
  id uuid primary key default gen_random_uuid(),
  plane text not null check (plane in ('business', 'pf', 'client')),
  account_id uuid not null,                 -- user_account / pf_account / client_account id
  token_hash text not null,                 -- sha256 of the raw token; raw lives only in the email
  expires_at timestamptz not null,
  used_at timestamptz,                       -- single-use: set on consume (or when superseded)
  created_at timestamptz not null default now()
);
create unique index if not exists password_reset_token_hash_uidx on password_reset_token (token_hash);
create index if not exists password_reset_token_acct_idx on password_reset_token (plane, account_id);

-- RLS on with NO policy and NO grants → app_user can't touch it at all; only the
-- owner-rights definers below read/write it.
alter table password_reset_token enable row level security;
alter table password_reset_token force row level security;

-- ============================================================================
-- SECURITY DEFINER functions — the sanctioned, narrow bypasses (owner-rights).
-- ============================================================================

-- pwreset_request: store a hashed, expiring token for an account. Invalidates any
-- prior LIVE token for the same (plane, account) first, so only the newest link
-- works. Called pre-auth (no context); the caller has already resolved the account
-- via the plane's *_auth_lookup / client_reset_lookup definer.
create or replace function pwreset_request(
  p_plane text, p_account_id uuid, p_token_hash text, p_expires_at timestamptz
) returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
  update password_reset_token
    set used_at = now()
    where plane = p_plane and account_id = p_account_id and used_at is null;
  insert into password_reset_token (plane, account_id, token_hash, expires_at)
  values (p_plane, p_account_id, p_token_hash, p_expires_at);
end $$;
revoke all on function pwreset_request(text, uuid, text, timestamptz) from public;
grant execute on function pwreset_request(text, uuid, text, timestamptz) to app_user;

-- pwreset_consume_business: atomically validate+spend a business reset token, set
-- the account's password, revoke ALL its live refresh tokens, audit. Returns the
-- account id on success, or NULL when there is no live token (invalid/expired/used)
-- — the caller maps NULL to a single generic error (no enumeration).
create or replace function pwreset_consume_business(p_token_hash text, p_new_hash text)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v_acct uuid; v_org uuid;
begin
  select account_id into v_acct
  from password_reset_token
  where plane = 'business' and token_hash = p_token_hash
    and used_at is null and expires_at > now()
  for update;
  if v_acct is null then return null; end if;

  update password_reset_token set used_at = now() where token_hash = p_token_hash;
  update user_account set password_hash = p_new_hash, updated_at = now()
    where id = v_acct
    returning org_id into v_org;
  if v_org is null then return null; end if;  -- account vanished (defensive)

  -- A reset kills every session (force re-login everywhere).
  update auth_refresh_token set revoked_at = now()
    where user_id = v_acct and revoked_at is null;
  insert into audit_log (org_id, actor_user_id, action, entity, entity_id)
  values (v_org, v_acct, 'auth.password_reset', 'user_account', v_acct);
  return v_acct;
end $$;
revoke all on function pwreset_consume_business(text, text) from public;
grant execute on function pwreset_consume_business(text, text) to app_user;

-- pwreset_consume_pf: PF analogue (pf_account / pf_refresh_token / pf_audit_log).
create or replace function pwreset_consume_pf(p_token_hash text, p_new_hash text)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v_acct uuid;
begin
  select account_id into v_acct
  from password_reset_token
  where plane = 'pf' and token_hash = p_token_hash
    and used_at is null and expires_at > now()
  for update;
  if v_acct is null then return null; end if;

  update password_reset_token set used_at = now() where token_hash = p_token_hash;
  update pf_account set password_hash = p_new_hash, updated_at = now() where id = v_acct;
  if not found then return null; end if;

  update pf_refresh_token set revoked_at = now()
    where pf_account_id = v_acct and revoked_at is null;
  insert into pf_audit_log (pf_account_id, action, entity, entity_id)
  values (v_acct, 'pf.password_reset', 'pf_account', v_acct);
  return v_acct;
end $$;
revoke all on function pwreset_consume_pf(text, text) from public;
grant execute on function pwreset_consume_pf(text, text) to app_user;

-- pwreset_consume_client: client analogue (client_account / client_refresh_token;
-- audits into the org-scoped audit_log, like other client-plane writes).
create or replace function pwreset_consume_client(p_token_hash text, p_new_hash text)
returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v_acct uuid; v_org uuid;
begin
  select account_id into v_acct
  from password_reset_token
  where plane = 'client' and token_hash = p_token_hash
    and used_at is null and expires_at > now()
  for update;
  if v_acct is null then return null; end if;

  update password_reset_token set used_at = now() where token_hash = p_token_hash;
  update client_account set password_hash = p_new_hash, updated_at = now()
    where id = v_acct
    returning org_id into v_org;
  if v_org is null then return null; end if;

  update client_refresh_token set revoked_at = now()
    where client_account_id = v_acct and revoked_at is null;
  insert into audit_log (org_id, actor_user_id, action, entity, entity_id)
  values (v_org, null, 'client.password_reset', 'client_account', v_acct);
  return v_acct;
end $$;
revoke all on function pwreset_consume_client(text, text) from public;
grant execute on function pwreset_consume_client(text, text) to app_user;

-- client_reset_lookup: resolve a client reset request by login_id to the address we
-- should email. A client's login_id may be a student/client id (not an email), so
-- prefer the party's contact email and fall back to the login_id. Auth columns +
-- the email only (pre-auth, no context — mirror client_auth_lookup).
create or replace function client_reset_lookup(p_login citext)
returns table (id uuid, status text, expires_at timestamptz, email text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select a.id, a.status, a.expires_at,
         coalesce(p.contact_json->>'email', a.login_id::text) as email
  from client_account a
  join party p on p.id = a.party_id
  where a.login_id = p_login
$$;
revoke all on function client_reset_lookup(citext) from public;
grant execute on function client_reset_lookup(citext) to app_user;
