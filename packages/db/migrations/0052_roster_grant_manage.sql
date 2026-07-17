-- ============================================================================
-- 0052_roster_grant_manage.sql — manage roster shares (follows 0051).
--
-- roster_grant is append-only for the app role (select+insert; no update/delete),
-- and its RLS only lets the GRANTEE see their own grant. So the OWNER of a shared
-- job/client can neither SEE who it's shared with nor REVOKE a share through normal
-- DML. Two SECURITY DEFINER functions close that — each ENFORCES that the caller
-- owns the subject (or is System SuperAdmin), reading the identity from the same
-- GUCs the RLS policies use. Mirrors the credential-vault manage/revoke definers
-- (0018), but adds the owner check the vault leaves to its permission gate.
-- ============================================================================

-- Who is a subject (work_item | client party) currently shared with? Owner/SuperAdmin only.
create or replace function roster_grant_list(p_subject_type text, p_subject_id uuid)
returns table (id uuid, party_id uuid, party_name text, reason text, granted_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select g.id, g.party_id, p.display_name, g.reason, g.granted_at
  from roster_grant g
  join party p on p.id = g.party_id
  where g.subject_type = p_subject_type
    and g.subject_id = p_subject_id
    and g.org_id = app_current_org()
    and g.revoked_at is null
    and (
      app_is_superadmin()
      or (p_subject_type = 'work_item'
          and exists (select 1 from work_item w
                      where w.id = p_subject_id and w.org_id = app_current_org()
                        and w.owner_party_id = app_current_party()))
      or (p_subject_type = 'party'
          and exists (select 1 from party pt
                      where pt.id = p_subject_id and pt.org_id = app_current_org()
                        and pt.owner_party_id = app_current_party()))
    )
  order by g.granted_at
$$;
revoke all on function roster_grant_list(text, uuid) from public;
grant execute on function roster_grant_list(text, uuid) to app_user;

-- Revoke the active grant for (subject, grantee). Owner/SuperAdmin only. Idempotent
-- (already-revoked / not-owned → zero rows). Returns the revoked grant ids.
create or replace function roster_grant_revoke(
  p_subject_type text, p_subject_id uuid, p_party uuid, p_actor uuid
)
returns table (id uuid)
language sql security definer set search_path = public, pg_temp
as $$
  update roster_grant g
     set revoked_at = now(), revoked_by = p_actor
   where g.subject_type = p_subject_type
     and g.subject_id = p_subject_id
     and g.party_id = p_party
     and g.org_id = app_current_org()
     and g.revoked_at is null
     and (
       app_is_superadmin()
       or (p_subject_type = 'work_item'
           and exists (select 1 from work_item w
                       where w.id = p_subject_id and w.org_id = app_current_org()
                         and w.owner_party_id = app_current_party()))
       or (p_subject_type = 'party'
           and exists (select 1 from party pt
                       where pt.id = p_subject_id and pt.org_id = app_current_org()
                         and pt.owner_party_id = app_current_party()))
     )
   returning g.id
$$;
revoke all on function roster_grant_revoke(text, uuid, uuid, uuid) from public;
grant execute on function roster_grant_revoke(text, uuid, uuid, uuid) to app_user;
