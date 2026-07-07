-- ============================================================================
-- 0036_cost_bearer_party_ref.sql — cost attribution can name any party
-- (BUSINESS_MODEL_AUDIT P0 item 1 / cross-cutting root cause). The cost-bearer
-- was a fixed 4-value app enum (momin|emon|split|writer) that hardcoded two
-- partner *identities* — it could not attribute a cost/salary to a third
-- partner (Antu/Shohan/Mohsin) or model HRM "salary owned by a partner".
--
-- Change: keep the `cost_bearer` text discriminator but redefine it to
-- {party|split|writer} and add a nullable `bearer_party_id` party reference.
--   party  → the partner named in bearer_party_id
--   split  → cost_bearer_split_json keyed by party UUID → share (was {momin,emon})
--   writer → the job's writer (unchanged semantics)
-- The DB columns were already `text`, so no type change — only a new column +
-- an in-place data migration of the two seeded partners (Momin c1 / Emon c2).
-- DATA MODEL ONLY: nothing here deducts an attributed cost from a partner's
-- derived P&L (that is a separate follow-on) — attribution is recorded, not
-- yet consumed by settlement/profit-share.
-- ============================================================================

-- 1. New party reference on the two cost-bearing tables.
alter table expense   add column if not exists bearer_party_id uuid references party(id);
alter table comp_rule add column if not exists bearer_party_id uuid references party(id);

-- 2. Migrate existing rows: the literal identities → (party, bearer_party_id).
--    Single-tenant; keys off the known seed party ids from 0002_seed.sql.
update expense   set bearer_party_id = '00000000-0000-4000-8000-0000000000c1', cost_bearer = 'party' where cost_bearer = 'momin';
update expense   set bearer_party_id = '00000000-0000-4000-8000-0000000000c2', cost_bearer = 'party' where cost_bearer = 'emon';
update comp_rule set bearer_party_id = '00000000-0000-4000-8000-0000000000c1', cost_bearer = 'party' where cost_bearer = 'momin';
update comp_rule set bearer_party_id = '00000000-0000-4000-8000-0000000000c2', cost_bearer = 'party' where cost_bearer = 'emon';

-- 3. Re-key the split breakdown from named strings to party UUIDs.
update expense
set cost_bearer_split_json = (
  select jsonb_object_agg(
    case k when 'momin' then '00000000-0000-4000-8000-0000000000c1'
           when 'emon'  then '00000000-0000-4000-8000-0000000000c2'
           else k end,
    v)
  from jsonb_each(cost_bearer_split_json) as e(k, v)
)
where cost_bearer = 'split'
  and cost_bearer_split_json is not null
  and (cost_bearer_split_json ? 'momin' or cost_bearer_split_json ? 'emon');

update comp_rule
set cost_bearer_split_json = (
  select jsonb_object_agg(
    case k when 'momin' then '00000000-0000-4000-8000-0000000000c1'
           when 'emon'  then '00000000-0000-4000-8000-0000000000c2'
           else k end,
    v)
  from jsonb_each(cost_bearer_split_json) as e(k, v)
)
where cost_bearer = 'split'
  and cost_bearer_split_json is not null
  and (cost_bearer_split_json ? 'momin' or cost_bearer_split_json ? 'emon');
