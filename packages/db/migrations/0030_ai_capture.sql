-- ============================================================================
-- 0030_ai_capture.sql — AI capture assistant (DESIGN_SPEC §10 capture-first / §2
-- governance). The user submits unstructured input (text / WhatsApp / image /
-- voice); a swappable provider EXTRACTS and PROPOSES draft records. The extract
-- step writes ONLY ai_proposal rows — never a domain record. A domain record is
-- created ONLY on explicit human Accept, through the existing create service,
-- stamped with an `ai_capture_id` provenance marker. The AI is the "propose"
-- actor; the human Accept is the governance "confirm". Nothing auto-commits —
-- especially money/visibility.
-- ============================================================================

-- ── ai_capture: one submission/batch ────────────────────────────────────────
create table ai_capture (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  kind text not null,                       -- text | whatsapp | image | voice
  input_text text,                          -- pasted text / transcript (null for raw media)
  file_object_id uuid references file_object(id),  -- media via the file pipeline
  provider text not null,                   -- dev | gemini | claude
  model text,
  status text not null default 'processing',-- processing | proposed | applied | discarded
  usage_tokens integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_capture_org_idx on ai_capture (org_id, created_at);

-- ── ai_proposal: each extracted candidate (a DRAFT, never a fact) ────────────
create table ai_proposal (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id),
  capture_id uuid not null references ai_capture(id),
  target_type text not null,                -- client | job | payment | expense
  proposed_json jsonb not null default '{}',
  confidence numeric(4,3),                  -- 0..1
  label text,                               -- a short human summary of the proposal
  status text not null default 'pending',   -- pending | accepted | rejected
  created_entity_type text,                 -- set on accept
  created_entity_id uuid,                   -- the record the human accepted into being
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index ai_proposal_capture_idx on ai_proposal (org_id, capture_id);
create index ai_proposal_pending_idx on ai_proposal (org_id, status);

-- ── ai_usage: append-only per-user usage ledger (the daily cap) ──────────────
create table ai_usage (
  id bigint primary key generated always as identity,
  org_id uuid not null references org(id),
  user_id uuid,
  used_on date not null default current_date,
  provider text not null,
  tokens integer not null default 0,
  capture_id uuid,
  at timestamptz not null default now()
);
create index ai_usage_cap_idx on ai_usage (org_id, user_id, used_on);

-- ── "added by AI" provenance marker on the records AI can create ─────────────
-- null = manual; set = created from an accepted AI proposal (links to the batch).
alter table party      add column ai_capture_id uuid references ai_capture(id);
alter table work_item  add column ai_capture_id uuid references ai_capture(id);
alter table payment    add column ai_capture_id uuid references ai_capture(id);
alter table expense    add column ai_capture_id uuid references ai_capture(id);

-- ── RLS: tenant isolation (same pattern as 0001_rls.sql) ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['ai_capture','ai_proposal','ai_usage'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I for all '
      'using (org_id = app_current_org()) '
      'with check (org_id = app_current_org())', t);
  end loop;
end$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- ai_capture + ai_proposal are mutable (status transitions, edits, accept stamps).
grant select, insert, update on ai_capture, ai_proposal to app_user;
-- ai_usage is an append-only ledger (the cap is counted, never edited).
grant select, insert on ai_usage to app_user;
grant usage, select on all sequences in schema public to app_user;

-- ── Seed the `ai_capture` permission module (owner/admin tier: a1/a2/a3) ──────
-- view + create for the capture/review surface; the Accept step additionally
-- requires the TARGET's create permission in-service, so Accept can't escalate.
insert into permission (org_id, role_id, module, action)
select '00000000-0000-4000-8000-000000000001', r::uuid, 'ai_capture', a
from unnest(array[
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2',
  '00000000-0000-4000-8000-0000000000a3'
]) r
cross join unnest(array['view','create','approve']) a
on conflict do nothing;
