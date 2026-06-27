-- ============================================================================
-- 0008_comp_provenance.sql — add provenance to comp_rule (additive).
-- SCHEMA §E gave deal_term created_by/created_at but omitted them on comp_rule;
-- comp rules are money-defining, so CLAUDE.md §4 provenance applies. Additive,
-- nullable created_by + defaulted created_at — not a spine redesign.
-- ============================================================================

alter table comp_rule
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now();
