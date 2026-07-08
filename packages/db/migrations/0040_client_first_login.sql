-- ============================================================================
-- 0040_client_first_login.sql — Forced password reset on a client's FIRST login
-- (P1 item 8; BUSINESS_MODEL_AUDIT §4.9). Client logins are AUTO-provisioned from
-- a student id + name (derivable initial credentials the admin hands over), so the
-- first login MUST force a reset before any session is issued — the derivable
-- password can never become a standing credential.
--
-- Adds a `must_reset_password` flag on client_account (default false, so every
-- existing account is unaffected). client_auth_lookup returns it (the login path
-- reads it pre-auth). pwreset_consume_client CLEARS it on a successful reset — the
-- one shipped code path that legitimately sets a new client password — so a reset
-- both satisfies and clears the requirement atomically, with no extra round-trip.
-- ============================================================================

alter table client_account
  add column if not exists must_reset_password boolean not null default false;

-- ─── client_auth_lookup: now also surfaces must_reset_password ────────────────
-- Return signature changes (new column) → drop then recreate (CREATE OR REPLACE
-- cannot alter a function's OUT columns). Definer/grants unchanged from 0033.
drop function if exists client_auth_lookup(citext);
create or replace function client_auth_lookup(p_login citext)
returns table (
  id uuid, org_id uuid, party_id uuid, password_hash text, status text,
  twofa_secret text, expires_at timestamptz, must_reset_password boolean
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select a.id, a.org_id, a.party_id, a.password_hash, a.status, a.twofa_secret,
         a.expires_at, a.must_reset_password
  from client_account a
  where a.login_id = p_login
$$;
revoke all on function client_auth_lookup(citext) from public;
grant execute on function client_auth_lookup(citext) to app_user;

-- ─── pwreset_consume_client: clear must_reset_password on a successful reset ───
-- Same body as 0034 plus `must_reset_password = false` in the account update — the
-- reset that sets a real password also lifts the forced-reset gate, atomically.
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
  update client_account
    set password_hash = p_new_hash, must_reset_password = false, updated_at = now()
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
