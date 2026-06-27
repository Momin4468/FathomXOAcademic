-- ============================================================================
-- 0001_rls.sql — Visibility enforced at the database (CLAUDE.md §3, spec §4).
--
-- Identity is carried per-request as transaction-local session GUCs that the
-- API sets at the start of every transaction:
--   app.org_id            — tenant scope (every row filtered by it)
--   app.current_party_id  — the acting party (drives leg visibility)
--   app.is_superadmin     — deliberate, audited break-glass over leg visibility
--
-- The app connects as the non-owner role `app_user` (created by the migrator),
-- so these policies actually bind. The schema owner (admin/superuser) bypasses
-- RLS, which is how migrations and seeds run.
-- ============================================================================

-- ─── Context accessors (null-safe: missing context => NULL => no rows) ───────

create or replace function app_current_org() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

create or replace function app_current_party() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.current_party_id', true), '')::uuid
$$;

create or replace function app_is_superadmin() returns boolean
  language sql stable as $$
  select coalesce(nullif(current_setting('app.is_superadmin', true), ''), 'false')::boolean
$$;

-- ─── Baseline tenant isolation on every table (org_id = current org) ────────
-- leg is excluded here and handled specially below (it adds leg-membership).

do $$
declare
  t text;
  tenant_tables text[] := array[
    'ref_entity','ref_alias','file_object','party','user_account','role',
    'permission','user_role','milestone_template','milestone_template_item',
    'project','milestone','work_item','work_line','deal_term','comp_rule',
    'invoice','invoice_line','payment','payment_allocation','payment_proof','audit_log'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I for all '
      'using (org_id = app_current_org()) '
      'with check (org_id = app_current_org())', t);
  end loop;
end$$;

-- org keys on id, not org_id.
alter table org enable row level security;
alter table org force row level security;
create policy tenant_isolation on org for all
  using (id = app_current_org())
  with check (id = app_current_org());

-- ─── The crux: leg visibility (structural opacity, spec §4) ─────────────────
-- A user may READ a leg only if SuperAdmin OR their party is from/to on it —
-- it isn't a toggle, a non-party simply has no row. INSERT only needs the
-- tenant check (an admin builds the whole chain without being on every leg).
alter table leg enable row level security;
alter table leg force row level security;
create policy leg_visibility on leg for all
  using (
    org_id = app_current_org()
    and (app_is_superadmin() or app_current_party() in (from_party_id, to_party_id))
  )
  with check (org_id = app_current_org());

-- ─── Privileges for the app role (DML is still subject to RLS above) ─────────
-- Tiering encodes the append-only ledger rule (CLAUDE.md §3.4): money/audit
-- rows can be inserted and read but never updated or deleted — corrections are
-- reversing entries.

grant usage on schema public to app_user;

-- Tenant root: read-only for the app (provisioning is an admin/superuser job).
grant select on org to app_user;

-- Full CRUD (mutable operational data).
grant select, insert, update, delete on
  ref_entity, ref_alias, file_object, party, user_account, role, permission,
  user_role, milestone_template, milestone_template_item, project, milestone,
  work_item, work_line
  to app_user;

-- Money-mutable but never hard-deleted (invoices are live groupings; rule
-- history closes by setting effective_to, never by deletion).
grant select, insert, update on
  invoice, invoice_line, deal_term, comp_rule
  to app_user;

-- Append-only: the immutable ledger + chain + audit (insert/select only).
grant select, insert on
  leg, payment, payment_allocation, payment_proof, audit_log
  to app_user;

-- audit_log identity column needs sequence usage.
grant usage, select on all sequences in schema public to app_user;
