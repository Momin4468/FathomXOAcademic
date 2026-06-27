-- ============================================================================
-- 0014_projects.sql — Projects/engagements support (DESIGN_SPEC §5; additive).
-- The spine tables (project, milestone, milestone_template, milestone_template_item)
-- and their tenant-RLS + full-CRUD grants already exist (0000/0001). This adds:
--  - work_item.trackable / billable: a child's two flags (trackable / billable /
--    both) — "the progress board reads trackable children; billing reads billable
--    children — same tree, two views". A plain job is the one-child case.
--  - provenance columns on project & milestone (created/updated/confirmed — §4).
--  - resolution/ordering indexes.
-- New columns ride the existing tenant_isolation policies + grants.
-- ============================================================================

-- Child work-item flags (default: trackable, not billable).
alter table work_item
  add column if not exists trackable boolean not null default true,
  add column if not exists billable  boolean not null default false;

-- Project provenance + completion stamp (status / estimate_amount already exist).
alter table project
  add column if not exists updated_by   uuid,
  add column if not exists updated_at   timestamptz not null default now(),
  add column if not exists confirmed_by uuid,
  add column if not exists confirmed_at timestamptz,
  add column if not exists archived_at  timestamptz;

-- Milestone provenance (due_at/due_tz/state/sort/flags already exist).
alter table milestone
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid,
  add column if not exists updated_at timestamptz not null default now();

-- Indexes for the project tree + template ordering.
create index if not exists work_item_project_idx       on work_item (project_id);
create index if not exists work_item_milestone_idx      on work_item (milestone_id);
create index if not exists milestone_project_sort_idx   on milestone (project_id, sort);
create index if not exists mti_template_sort_idx        on milestone_template_item (template_id, sort);
