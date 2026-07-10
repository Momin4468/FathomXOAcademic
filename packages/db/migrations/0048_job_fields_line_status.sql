-- 0048 — Phase 4: §3.1-complete job fields + per-line lifecycle status.
--
-- Phase 4C: first-class academic fields the job form should capture (previously
-- missing or buried in free-text). `client_party_id` is the paying student, kept
-- DISTINCT from `source_party_id` (the referral/source that drives profit-share,
-- unchanged — this protects the channels/deal-term engine).
--
-- Phase 4A: `work_line.line_status` — a per-LINE lifecycle. A job's status is a
-- ROLLUP of its lines (e.g. "2/3 submitted"), derived at read, never stored.
--   draft      — client-portal submissions only; internal logging skips it
--   pending    — logged, editable, not yet submitted   (the default)
--   submitted  — writer's part done, still editable, awaiting billing
--   billed     — invoiced; set in the SAME action that flips money_state→invoiced
--   cancelled  — reachable only from pending/submitted, never from billed
-- Additive only; all existing rows take the defaults. Resits are untouched (they
-- live on work_outcome, independent of this enum).

alter table work_item
  add column if not exists client_party_id uuid references party(id),
  add column if not exists university_ref_id uuid references ref_entity(id),
  add column if not exists module_name text,
  add column if not exists group_kind text not null default 'individual',
  add column if not exists group_scope text,
  add column if not exists group_note text,
  add column if not exists delivery_date date,
  add column if not exists submission_date date,
  add column if not exists word_count integer;

alter table work_item
  add constraint work_item_group_kind_chk check (group_kind in ('individual', 'group')),
  add constraint work_item_group_scope_chk check (group_scope is null or group_scope in ('full', 'partial'));

create index if not exists work_item_client_party_idx on work_item (org_id, client_party_id);

alter table work_line
  add column if not exists line_status text not null default 'pending';

alter table work_line
  add constraint work_line_status_chk
  check (line_status in ('draft', 'pending', 'submitted', 'billed', 'cancelled'));

create index if not exists work_line_status_idx on work_line (org_id, line_status);
