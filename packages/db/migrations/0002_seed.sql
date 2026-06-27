-- ============================================================================
-- 0002_seed.sql — Minimal seed so RLS is testable and the API has real ids.
-- Runs as the schema owner (bypasses RLS). Idempotent via fixed UUIDs + ON
-- CONFLICT DO NOTHING. NOT production data — password hashes are placeholders
-- until `pnpm --filter @business-os/api seed:auth` sets dev passwords.
--
-- Fixed UUIDs are RFC-4122 v4-shaped (version nibble 4, variant nibble 8) so
-- they pass @IsUUID()/ParseUUIDPipe validation while staying deterministic.
-- ============================================================================

-- ─── Tenant ─────────────────────────────────────────────────────────────────
insert into org (id, name) values
  ('00000000-0000-4000-8000-000000000001', 'FathomXO — Academic')
on conflict (id) do nothing;

-- ─── Roles (spec §4.3 defaults; is_system=true) ──────────────────────────────
insert into role (id, org_id, name, is_system) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'System SuperAdmin',   true),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'Business SuperAdmin', true),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 'Admin',               true),
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-000000000001', 'Manager',             true),
  ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-000000000001', 'Coordinator',         true),
  ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-000000000001', 'Writer',              true),
  ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-000000000001', 'QA',                  true),
  ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-000000000001', 'Vendor',              true),
  ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-000000000001', 'Referrer',            true)
on conflict (id) do nothing;

-- ─── Permissions (module × action × scope) for the testable roles ────────────
-- The permission engine reads these for module/action gating; row visibility is
-- the DB RLS floor laid in 0001. Seeded representative grants:

-- System SuperAdmin: every module × every action.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', m, a
from unnest(array['platform','reference','work','rules','capture','billing','expenses']) m
cross join unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- Business SuperAdmin: view across all modules (aggregated/settlement use later).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', m, 'view'
from unnest(array['platform','reference','work','rules','capture','billing','expenses']) m
on conflict do nothing;

-- Admin (Momin/Emon): full actions on the operational modules (own-scope later).
-- Deliberately NOT granted the 'platform' module (no self-promotion; spec §10).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', m, a
from unnest(array['reference','work','rules','capture','billing','expenses']) m
cross join unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- Writer: view/create on work + capture (own jobs).
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a6', m, a
from unnest(array['work','capture']) m
cross join unnest(array['view','create']) a
on conflict do nothing;

-- ─── Parties (the two partners) ──────────────────────────────────────────────
insert into party (id, org_id, display_name, party_type) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'Momin', '{partner,writer}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', 'Emon',  '{partner}')
on conflict (id) do nothing;

-- ─── User accounts (linked, not merged, to parties) ──────────────────────────
insert into user_account (id, org_id, email, password_hash, party_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001', 'sysadmin@fathomxo.local', 'SEED_PLACEHOLDER_NOT_A_REAL_HASH', null),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-000000000001', 'bizadmin@fathomxo.local', 'SEED_PLACEHOLDER_NOT_A_REAL_HASH', null),
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-000000000001', 'momin@fathomxo.local',    'SEED_PLACEHOLDER_NOT_A_REAL_HASH', '00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-000000000001', 'emon@fathomxo.local',     'SEED_PLACEHOLDER_NOT_A_REAL_HASH', '00000000-0000-4000-8000-0000000000c2')
on conflict (id) do nothing;

-- ─── Role assignments (multi-hat) ────────────────────────────────────────────
insert into user_role (org_id, user_id, role_id) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1'), -- sysadmin -> System SuperAdmin
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000a2'), -- bizadmin -> Business SuperAdmin
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000a3'), -- Momin -> Admin
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000a6'), -- Momin -> Writer (multi-hat)
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000a3')  -- Emon -> Admin
on conflict do nothing;
