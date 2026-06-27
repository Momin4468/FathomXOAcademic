-- ============================================================================
-- 0006_work.sql — Module 2 schema support (additive; not a spine redesign).
--  - work_line.source_line_id: a fanned CONSUMER line points back to the one
--    PRODUCER line it came from (copy fan-out, §3.2 producer↔consumer link).
--  - Indexes for the leg chain and a job's lines.
-- Tables (work_item, work_line, leg) and the leg-visibility RLS already exist
-- (0000/0001); the new column rides the existing tenant policies + grants.
-- ============================================================================

alter table work_line
  add column if not exists source_line_id uuid references work_line(id);

create index if not exists leg_work_item_seq_idx on leg (work_item_id, seq);
create index if not exists work_line_work_item_idx on work_line (work_item_id);
create index if not exists work_line_source_idx on work_line (source_line_id);
