-- ============================================================================
-- 0019_knowledge.sql — Module 9: knowledge base + cover-sheet templates (§7/§8).
--  - knowledge_article: docs / prompt packs / blogs. Open authoring (any role
--    with knowledge:create); optionally linked to a university and/or programme
--    (ref_entity) so opening a university surfaces its articles.
--  - knowledge_attachment: article ↔ file_object (media under the file rule).
--  - cover_sheet_template: a university/programme cover sheet = reference data +
--    an attached file_object; readable by all (knowledge:view).
-- Mutable operational data, tenant-RLS. Media bytes live in object storage (the
-- file pipeline) — these tables hold only references.
-- ============================================================================

create table knowledge_article (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  type text not null,                          -- doc | prompt_pack | blog
  title text not null,
  body text,
  university_ref_id uuid references ref_entity(id),
  programme_ref_id uuid references ref_entity(id),
  status text not null default 'published',     -- draft | published
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index knowledge_article_org_idx on knowledge_article (org_id);
create index knowledge_article_university_idx on knowledge_article (university_ref_id);
create index knowledge_article_programme_idx on knowledge_article (programme_ref_id);

create table knowledge_attachment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  article_id uuid not null references knowledge_article(id),
  file_object_id uuid not null references file_object(id),
  created_by uuid, created_at timestamptz not null default now()
);
create index knowledge_attachment_article_idx on knowledge_attachment (article_id);

create table cover_sheet_template (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  name text not null,
  university_ref_id uuid references ref_entity(id),
  programme_ref_id uuid references ref_entity(id),
  file_object_id uuid references file_object(id),
  notes text,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index cover_sheet_template_university_idx on cover_sheet_template (university_ref_id);

-- ── RLS: tenant isolation (reuse the 0001 pattern) ──────────────────────────
alter table knowledge_article enable row level security;
alter table knowledge_article force row level security;
create policy tenant_isolation on knowledge_article for all
  using (org_id = app_current_org()) with check (org_id = app_current_org());

alter table knowledge_attachment enable row level security;
alter table knowledge_attachment force row level security;
create policy tenant_isolation on knowledge_attachment for all
  using (org_id = app_current_org()) with check (org_id = app_current_org());

alter table cover_sheet_template enable row level security;
alter table cover_sheet_template force row level security;
create policy tenant_isolation on cover_sheet_template for all
  using (org_id = app_current_org()) with check (org_id = app_current_org());

-- Mutable operational data: articles/cover-sheets archive (no delete); an
-- attachment can be removed (delete the join row; the file_object remains).
grant select, insert, update on knowledge_article to app_user;
grant select, insert, delete on knowledge_attachment to app_user;
grant select, insert, update on cover_sheet_template to app_user;

-- ── Seed the 'knowledge' permission module ───────────────────────────────────
-- System SuperAdmin + Admin: all actions.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'knowledge', a
from unnest(array['00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a3']) r
cross join unnest(array['view','create','edit','approve']) a
on conflict do nothing;

-- Business SuperAdmin: view.
insert into permission (org_id, role_id, module, action) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'knowledge', 'view')
on conflict do nothing;

-- Open authoring: every operational role may view + create (Manager, Coordinator,
-- Writer, QA). Curation (edit-others / publish / cover-sheets) needs approve.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'knowledge', a
from unnest(array[
  '00000000-0000-4000-8000-0000000000a4','00000000-0000-4000-8000-0000000000a5',
  '00000000-0000-4000-8000-0000000000a6','00000000-0000-4000-8000-0000000000a7'
]) r
cross join unnest(array['view','create']) a
on conflict do nothing;
