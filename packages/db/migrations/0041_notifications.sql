-- ============================================================================
-- 0041_notifications.sql — in-app notifications + admin broadcast (BUSINESS_MODEL
-- AUDIT P1 item 7; also closes UI_AUDIT R6's "no in-app notice surface"). A
-- notification is per-USER operational state (read/unread), NOT the money ledger:
-- tenant-isolation RLS with select/insert/update grants (read_at is an update),
-- like `task`/`pf_note`, not the append-only leg/payment tables. Per-user
-- self-scoping (recipient_user_id = the caller) is enforced in-service under the
-- tenant GUC (the same pattern as dashboards/tasks — the RLS GUC carries org +
-- party, not user). A broadcast fans out to N notification rows in one tx.
-- ============================================================================

create table if not exists notification_broadcast (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  audience_kind text not null check (audience_kind in ('all', 'role', 'users')),
  audience_json jsonb,                         -- role_id (kind=role) or user_id[] (kind=users)
  title text not null,
  body text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists notification_broadcast_org_idx on notification_broadcast (org_id);

create table if not exists notification (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  recipient_user_id uuid not null references user_account(id),
  kind text not null default 'info',           -- info | broadcast | <event kinds later>
  title text not null,
  body text,
  read_at timestamptz,                          -- null = unread; set on mark-read (an UPDATE)
  broadcast_id uuid references notification_broadcast(id),
  created_by uuid,
  created_at timestamptz not null default now()
);
-- Unread-first, per-recipient reads: (org, recipient) then created_at.
create index if not exists notification_recipient_idx on notification (org_id, recipient_user_id, created_at desc);

-- ─── RLS: tenant isolation (config/operational, not the ledger) ───────────────
alter table notification_broadcast enable row level security;
alter table notification_broadcast force row level security;
create policy tenant_isolation on notification_broadcast for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
grant select, insert on notification_broadcast to app_user;

alter table notification enable row level security;
alter table notification force row level security;
create policy tenant_isolation on notification for all
  using (org_id = app_current_org())
  with check (org_id = app_current_org());
grant select, insert, update on notification to app_user;

-- ─── Permissions (module 'notifications') ─────────────────────────────────────
-- Every seeded role reads its OWN notifications (view); only admins/superadmins
-- may broadcast (approve). Roles are data (rule 9) — seed, don't hardcode.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r, 'notifications', 'view'
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3','00000000-0000-4000-8000-0000000000a4',
  '00000000-0000-4000-8000-0000000000a5','00000000-0000-4000-8000-0000000000a6',
  '00000000-0000-4000-8000-0000000000a7','00000000-0000-4000-8000-0000000000a8',
  '00000000-0000-4000-8000-0000000000a9'
]::uuid[]) r
on conflict do nothing;

insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r, 'notifications', 'approve'
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3'
]::uuid[]) r
on conflict do nothing;
