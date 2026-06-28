-- ============================================================================
-- 0028_personal_notes.sql — Personal Notes, inside the Personal Finance plane (§11).
--
-- The PF plane is the user's PRIVATE plane (§4.1 — each user is admin of their
-- own; the business, SuperAdmin included, sees none of it). Notes share that
-- exact privacy model, so they live here: scoped by pf_account_id, isolated by
-- the same `pf_account_isolation` RLS (NO superadmin clause — a business
-- transaction sets no app.pf_account_id and reads zero rows).
--
-- Notes are editable scratch data (lists / reminders / free text / attachments),
-- NOT a money ledger — so `update` is allowed and there is no append-only/reverse
-- constraint. Attachments follow the file rule (DB stores metadata + a reference,
-- never blobs): small files → StorageService key; large → external link.
-- ============================================================================

create table pf_note (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  title text,
  body text,
  items jsonb not null default '[]',              -- checklist: array of {text, done}
  color text,                                     -- small fixed palette (NOTE_COLORS)
  pinned boolean not null default false,
  remind_on date,                                 -- optional email reminder, fires on the day
  last_reminded_on date,                          -- idempotency for the reminder
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz                         -- soft delete + restore
);
create index pf_note_acct_idx on pf_note (pf_account_id, archived_at, pinned);
-- Lets the reminder cron find due notes per account cheaply.
create index pf_note_remind_idx on pf_note (remind_on) where archived_at is null and remind_on is not null;

create table pf_note_attachment (
  id uuid primary key default gen_random_uuid(),
  pf_account_id uuid not null references pf_account(id),
  note_id uuid not null references pf_note(id),
  is_link boolean not null,                       -- true = external URL; false = stored file
  url text not null,                              -- storage KEY (uploaded) or external URL (link)
  filename text,
  size_bytes bigint,
  mime text,
  created_at timestamptz not null default now()
);
create index pf_note_attachment_note_idx on pf_note_attachment (pf_account_id, note_id);

-- ─── RLS: account isolation (same pattern as the other pf_* tables) ───────────
do $$
declare t text;
begin
  foreach t in array array['pf_note','pf_note_attachment'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy pf_account_isolation on %I for all '
      'using (pf_account_id = app_current_pf_account()) '
      'with check (pf_account_id = app_current_pf_account())', t);
  end loop;
end$$;

-- ─── Grants (notes are editable; attachments can be removed) ──────────────────
grant select, insert, update on pf_note to app_user;
grant select, insert, delete on pf_note_attachment to app_user;
grant usage, select on all sequences in schema public to app_user;
