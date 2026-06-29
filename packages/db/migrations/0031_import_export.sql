-- ============================================================================
-- 0031_import_export.sql — Import / Export / Archive (one module).
--
-- Import stages a CSV/Excel upload as import_row rows (no domain write), shows a
-- dry-run preview, then COMMITS each valid row through the EXISTING create
-- services (validation, RLS, provenance, canonical reference resolution all
-- apply) — stamped with an `import_batch_id` marker. Export reuses the existing
-- RLS-scoped list read-models (so a viewer can't export a figure they can't
-- see). Archive is a dated, searchable store of business files reusing the file
-- pipeline. Policy: 2025 = opening settlement position only (no fabricated jobs).
-- ============================================================================

-- ── import_batch: one upload ─────────────────────────────────────────────────
create table import_batch (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  entity_type text not null,                -- clients | jobs | payments | settlement_opening
  filename text,
  status text not null default 'preview',   -- preview | committed | discarded
  row_total integer not null default 0,
  valid_count integer not null default 0,
  invalid_count integer not null default 0,
  committed_count integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_batch_org_idx on import_batch (org_id, created_at);

-- ── import_row: one staged row (a DRAFT; never a domain fact until commit) ────
create table import_row (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  batch_id uuid not null references import_batch(id),
  row_number integer not null,
  raw_json jsonb not null default '{}',     -- the parsed cells (human headers)
  mapped_json jsonb not null default '{}',  -- the resolved create DTO
  status text not null default 'valid',     -- valid | invalid | committed | failed
  errors_json jsonb,                        -- validation/commit errors
  resolution_json jsonb,                    -- e.g. {"course":"ICT701 (canonical)","client":"will create"}
  created_entity_type text,
  created_entity_id uuid,
  created_at timestamptz not null default now()
);
create index import_row_batch_idx on import_row (org_id, batch_id);

-- ── archive_item: dated, searchable business-file store (read-only content) ───
create table archive_item (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  title text not null,
  description text,
  doc_date date,
  tags text[] not null default '{}',
  file_object_id uuid references file_object(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index archive_item_org_idx on archive_item (org_id, doc_date);

-- ── "added by import" provenance marker on the records import can create ──────
alter table party              add column import_batch_id uuid references import_batch(id);
alter table work_item          add column import_batch_id uuid references import_batch(id);
alter table payment            add column import_batch_id uuid references import_batch(id);
alter table expense            add column import_batch_id uuid references import_batch(id);
alter table settlement_transfer add column import_batch_id uuid references import_batch(id);

-- ── RLS: tenant isolation (same pattern as 0001_rls.sql) ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['import_batch','import_row','archive_item'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I for all '
      'using (org_id = app_current_org()) '
      'with check (org_id = app_current_org())', t);
  end loop;
end$$;

-- ── Grants (mutable staging + archive metadata; never hard-deleted) ──────────
grant select, insert, update on import_batch, import_row, archive_item to app_user;
grant usage, select on all sequences in schema public to app_user;

-- ── Seed the `import_export` permission module (owner/admin tier a1/a2/a3) ────
-- view = export + archive read + import review; create = upload/commit/archive.
-- Commit additionally requires the TARGET entity's create permission in-service.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'import_export', a
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3'
]) r
cross join unnest(array['view','create','approve']) a
on conflict do nothing;
