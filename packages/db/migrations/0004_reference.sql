-- ============================================================================
-- 0004_reference.sql — Module 1 schema support (DDL only; seed is 0005).
--
-- Additive extensions to the spine (NOT a redesign):
--  - pg_trgm for typo-tolerant type-ahead ranking.
--  - ref_entity: archived_at + merged_into_id, so a steward can MERGE a duplicate
--    into a canonical survivor and the old name still resolves (follow the redirect).
--  - party: referred_by_party_id (self-ref) for the directory's "referred-by".
-- ============================================================================

create extension if not exists pg_trgm;

alter table ref_entity
  add column if not exists archived_at timestamptz,
  add column if not exists merged_into_id uuid references ref_entity(id);

alter table party
  add column if not exists referred_by_party_id uuid references party(id);

-- Fuzzy search indexes (trigram) + keep the existing (org_id, normalized) btree.
create index if not exists ref_alias_normalized_trgm
  on ref_alias using gin (normalized gin_trgm_ops);
create index if not exists ref_entity_canonical_trgm
  on ref_entity using gin (canonical gin_trgm_ops);

-- No exact-duplicate alias (same normalized spelling) on the same entity.
alter table ref_alias add constraint ref_alias_uq unique (org_id, ref_id, normalized);
