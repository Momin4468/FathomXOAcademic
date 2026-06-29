-- ============================================================================
-- 0033_client_portal.sql — Client portal: a THIRD scoped identity plane
-- (DESIGN_SPEC §4.1 planes; module 18). After business users (user_account) and
-- PF accounts (pf_account), clients get their own login.
--
-- A client is already a `party` (party_type 'client'); the portal is a SCOPED,
-- REDACTED view of existing business data + an inbound DRAFT path — NOT a new
-- data plane. So unlike PF (its own GUC + private tables), the client plane reuses
-- the BUSINESS RLS context scoped to the client's party (org_id + current_party_id
-- = the client + is_superadmin=false). work_item/invoice have no row-RLS, so every
-- client read goes through a CALLER-GUARDED SECURITY DEFINER (mirror referrer_works,
-- 0021) that returns only status + the client's own consumer-side amounts — NEVER
-- the writer, margin, or chain.
--
-- Identity: client_account (own credentials, like pf_account) maps 1:1 to a client
-- party. Tokens carry a distinct typ (client_access/client_refresh) so no plane's
-- token authenticates another. Admin-provisioned now; the `lead` status + expires_at
-- + the retention purge are the seam for the future public quotation funnel (a lead
-- is promoted to a real client when its job is confirmed; unconverted leads expire).
-- ============================================================================

-- ─── client_account: the separate client identity (1:1 with a client party) ───
create table if not exists client_account (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  party_id uuid not null references party(id),     -- the client this login is for
  login_id citext not null unique,                 -- credential: an email OR a client/student id
  password_hash text not null,
  twofa_secret text,                               -- sealed (enc:) AES-GCM, optional
  status text not null default 'invited',          -- invited | active | lead | deactivated
  expires_at timestamptz,                          -- set for leads; null = never expires
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
-- One login per client party (one login ↔ one party).
create unique index if not exists client_account_party_uidx on client_account (party_id);
create index if not exists client_account_org_idx on client_account (org_id);
create index if not exists client_account_expiry_idx on client_account (status, expires_at);

-- ─── client_refresh_token: hashed, rotating, per-device (mirror pf_refresh_token)
create table if not exists client_refresh_token (
  id uuid primary key default gen_random_uuid(),
  client_account_id uuid not null references client_account(id),
  token_hash text not null,
  device_label text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists client_refresh_token_acct_idx on client_refresh_token (client_account_id);
create index if not exists client_refresh_token_hash_idx on client_refresh_token (client_account_id, token_hash);

-- ─── client_message: the client↔admin thread (one thread per client party) ────
create table if not exists client_message (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  party_id uuid not null references party(id),     -- the client whose thread this is
  body text not null,
  sender text not null,                            -- client | admin
  created_by_client_account_id uuid references client_account(id),
  created_by_user_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists client_message_thread_idx on client_message (org_id, party_id, created_at);

-- ─── provenance marker: a client-submitted draft ──────────────────────────────
alter table work_item add column if not exists client_account_id uuid references client_account(id);
create index if not exists work_item_client_account_idx on work_item (client_account_id);

-- ─── RLS ───────────────────────────────────────────────────────────────────────
-- client_account + client_message are tenant-scoped (org). Admins manage them
-- org-scoped (gated client_portal:*); the CLIENT reads its own slice ONLY through
-- the caller-guarded definers below (the client plane never raw-selects these),
-- exactly as it reads work_item/invoice. client_refresh_token has NO org column
-- and (like pf_refresh_token) carries no RLS — it is touched ONLY by the auth
-- service, always scoped by (client_account_id, token_hash); the stored value is
-- a hash, and rotation/reuse-detection bound the risk.
do $$
declare t text;
begin
  foreach t in array array['client_account','client_message'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I for all '
      'using (org_id = app_current_org()) with check (org_id = app_current_org())', t);
  end loop;
end$$;

grant select, insert, update on client_account to app_user;        -- credential/config (not a ledger)
grant select, insert, update, delete on client_refresh_token to app_user;  -- rotation + purge
grant select, insert, update on client_message to app_user;        -- read_at marking

-- ─── client_portal permission module (admin-side management) ──────────────────
-- System SuperAdmin + Admin: all actions; Business SuperAdmin: view.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'client_portal', a
from unnest(array['00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a3']) r
cross join unnest(array['view','create','edit','approve']) a
on conflict do nothing;
insert into permission (org_id, role_id, module, action)
values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000a2','client_portal','view')
on conflict do nothing;

-- ============================================================================
-- SECURITY DEFINER functions — the sanctioned, narrow bypasses.
-- ============================================================================

-- client_auth_lookup: the client login bypass (mirror pf_auth_lookup). Pre-login
-- there's no GUC context, so this reads the credential row by login_id. Auth +
-- the party id (so the token can carry partyId/orgId) only.
drop function if exists client_auth_lookup(citext);
create or replace function client_auth_lookup(p_login citext)
returns table (id uuid, org_id uuid, party_id uuid, password_hash text, status text, twofa_secret text, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select a.id, a.org_id, a.party_id, a.password_hash, a.status, a.twofa_secret, a.expires_at
  from client_account a
  where a.login_id = p_login
$$;
revoke all on function client_auth_lookup(citext) from public;
grant execute on function client_auth_lookup(citext) to app_user;

-- client_works: the client's OWN jobs + their consumer-side billing rollup.
-- Caller-guarded to the client (or System SuperAdmin). Returns status + the
-- client's own billed/paid/due — NEVER the doer/writer, legs, margin, or rates.
create or replace function client_works(p_client uuid)
returns table (
  work_item_id uuid, title text, work_state text, money_state text,
  amount_billed numeric, amount_paid numeric, amount_due numeric, created_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select wi.id, wi.title, wi.work_state, wi.money_state,
         coalesce(b.billed, 0) as amount_billed,
         coalesce(b.paid, 0) as amount_paid,
         coalesce(b.billed, 0) - coalesce(b.paid, 0) as amount_due,
         wi.created_at
  from work_item wi
  left join lateral (
    select coalesce(sum(il.amount), 0) as billed,
           coalesce(sum((select coalesce(sum(pa.amount), 0) from payment_allocation pa
                         where pa.invoice_line_id = il.id)), 0) as paid
    from invoice_line il
    join work_line wl on wl.id = il.work_line_id
    join invoice i on i.id = il.invoice_id
    where wl.work_item_id = wi.id and i.client_party_id = p_client and i.status <> 'void'
  ) b on true
  where wi.org_id = app_current_org()
    and wi.source_party_id = p_client
    and wi.archived_at is null
    and (app_is_superadmin() or app_current_party() = p_client)
  order by wi.created_at desc
$$;
revoke all on function client_works(uuid) from public;
grant execute on function client_works(uuid) to app_user;

-- client_outstanding: the client's total billed/paid/due (their AR position).
-- Caller-guarded; never exposes a leg/margin.
create or replace function client_outstanding(p_client uuid)
returns table (billed numeric, paid numeric, due numeric)
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(sum(il.amount), 0) as billed,
         coalesce(sum(alloc.paid), 0) as paid,
         coalesce(sum(il.amount), 0) - coalesce(sum(alloc.paid), 0) as due
  from invoice i
  join invoice_line il on il.invoice_id = i.id
  left join lateral (
    select coalesce(sum(pa.amount), 0) as paid
    from payment_allocation pa where pa.invoice_line_id = il.id
  ) alloc on true
  where i.org_id = app_current_org() and i.client_party_id = p_client and i.status <> 'void'
    and (app_is_superadmin() or app_current_party() = p_client)
$$;
revoke all on function client_outstanding(uuid) from public;
grant execute on function client_outstanding(uuid) to app_user;

-- client_messages: the client's OWN thread (caller-guarded).
create or replace function client_messages(p_client uuid)
returns table (id uuid, body text, sender text, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select m.id, m.body, m.sender, m.read_at, m.created_at
  from client_message m
  where m.org_id = app_current_org() and m.party_id = p_client
    and (app_is_superadmin() or app_current_party() = p_client)
  order by m.created_at
$$;
revoke all on function client_messages(uuid) from public;
grant execute on function client_messages(uuid) to app_user;

-- ─── Lead promotion on job confirm (decoupled DB trigger) ─────────────────────
-- When a client-submitted job (client_account_id set) becomes 'confirmed', promote
-- a lead account to a real client (active, no expiry) and confirm its provisional
-- party. Decoupled from the work module: fires regardless of which code path
-- confirmed the job, and is a no-op when no lead is attached. Provisional parties
-- reuse the reference-data governance ('provisional' → confirmed on conversion).
create or replace function client_promote_lead_on_confirm() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.work_state = 'confirmed' and coalesce(old.work_state, '') <> 'confirmed'
     and new.client_account_id is not null then
    update client_account
      set status = 'active', expires_at = null, updated_at = now()
      where id = new.client_account_id and status = 'lead';
  end if;
  return new;
end $$;

drop trigger if exists client_promote_lead_trg on work_item;
create trigger client_promote_lead_trg
  after update of work_state on work_item
  for each row execute function client_promote_lead_on_confirm();

-- ─── Retention purge: unconverted leads past expiry (storage safety) ──────────
-- Deletes 'lead' accounts past expires_at that have NO confirmed work_item, plus
-- their unconverted DRAFT requests (and the request rows' brief stays in file_object
-- — the app sweeps storage; here we drop the DB rows). Org-scoped to the caller;
-- the cron runs it per org. Never touches an 'active' client or a lead with
-- confirmed work. Returns the count purged.
create or replace function client_purge_expired_leads() returns integer
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v_count int := 0; v_acct uuid;
begin
  for v_acct in
    select a.id from client_account a
    where a.org_id = app_current_org()
      and a.status = 'lead'
      and a.expires_at is not null and a.expires_at < now()
      and not exists (
        select 1 from work_item wi
        where wi.client_account_id = a.id and wi.work_state = 'confirmed'
      )
  loop
    -- drop the lead's unconverted (non-confirmed) draft requests
    delete from client_message where created_by_client_account_id = v_acct;
    delete from work_item where client_account_id = v_acct and work_state <> 'confirmed';
    delete from client_refresh_token where client_account_id = v_acct;
    delete from client_account where id = v_acct;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function client_purge_expired_leads() from public;
grant execute on function client_purge_expired_leads() to app_user;
