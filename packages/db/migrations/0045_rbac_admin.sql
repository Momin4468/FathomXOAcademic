-- ============================================================================
-- 0045_rbac_admin.sql — the RBAC MANAGEMENT layer (roles/permissions admin).
-- The schema already models RBAC (role/permission/user_role, all tenant-RLS); this
-- migration adds only what the admin UI needs on top of it:
--   (1) role.description — a human note shown in the Roles editor (the create/edit
--       form has a Description field; no such column existed).
--   (2) idempotent grant/assign — unique constraints so the toggle endpoints can
--       "grant = insert-if-absent, revoke = delete" and assign is insert-once.
--       permission is unique per (org, role, module, action); a user holds a given
--       role at most once (org, user, role).
-- action stays FREE TEXT (no CHECK) per SCHEMA.md "types are data" — delete/export
-- are storable actions the grid can grant even though no endpoint enforces them yet.
-- No RLS change: role/permission/user_role already have tenant_isolation (0001) and
-- app_user already holds full DML on them.
-- ============================================================================

alter table role add column if not exists description text;

-- Defensive de-dup before the unique indexes (seeds shouldn't have dupes, but a
-- re-run of an ON CONFLICT-less seed theoretically could). Keep the lowest ctid.
delete from permission p
  using permission q
  where p.org_id = q.org_id
    and p.role_id = q.role_id
    and p.module = q.module
    and p.action = q.action
    and p.ctid > q.ctid;

delete from user_role ur
  using user_role uq
  where ur.org_id = uq.org_id
    and ur.user_id = uq.user_id
    and ur.role_id = uq.role_id
    and ur.ctid > uq.ctid;

create unique index if not exists permission_role_module_action_uniq
  on permission (org_id, role_id, module, action);

create unique index if not exists user_role_user_role_uniq
  on user_role (org_id, user_id, role_id);
