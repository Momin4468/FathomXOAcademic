-- ============================================================================
-- 0005_seed_reference.sql — Module 1 seed (run by the seed script, after 0002).
--  - Data Steward: a delegable role (reference:view + reference:approve) so
--    confirm/merge can go to non-owners (spec §7). Admin + System SuperAdmin
--    already hold reference:* from 0002.
--  - Demo canonical course "ICT 701" with aliases so fuzzy/type-ahead has data.
-- Normalized values match @business-os/shared normalize() (lowercase, strip
-- non-alphanumerics): "ICT 701"/"ICT701" -> ict701, "701" -> 701.
-- ============================================================================

-- ─── Data Steward role + permissions ─────────────────────────────────────────
insert into role (id, org_id, name, is_system) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000001', 'Data Steward', true)
on conflict (id) do nothing;

insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', 'reference', a
from unnest(array['view','approve']) a
on conflict do nothing;

-- ─── Demo canonical reference data ───────────────────────────────────────────
insert into ref_entity (id, org_id, kind, canonical, status) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000001', 'university', 'University of Example', 'confirmed'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000001', 'course',     'ICT 701',               'confirmed')
on conflict (id) do nothing;

-- course -> university parent
update ref_entity set parent_id = '00000000-0000-4000-8000-0000000000e1'
  where id = '00000000-0000-4000-8000-0000000000e2' and parent_id is null;

-- Aliases (one row per distinct normalized spelling).
insert into ref_alias (org_id, ref_id, alias, normalized) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1', 'University of Example', 'universityofexample'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e2', 'ICT 701', 'ict701'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e2', '701',     '701')
on conflict (org_id, ref_id, normalized) do nothing;
