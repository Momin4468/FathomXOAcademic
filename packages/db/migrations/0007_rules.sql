-- ============================================================================
-- 0007_rules.sql — Module 3 resolution-lookup indexes (additive; no DDL/RLS
-- changes). deal_term/comp_rule already have effective_from/to and the
-- mutable-but-no-delete grants (0001) that the supersede pattern needs.
-- ============================================================================

create index if not exists deal_term_lookup_idx
  on deal_term (org_id, from_party_id, to_party_id, term_type, effective_from);

create index if not exists comp_rule_lookup_idx
  on comp_rule (org_id, party_id, role_id, basis, effective_from);
