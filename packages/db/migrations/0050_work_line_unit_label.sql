-- 0050 — a rate UNIT LABEL on work_line (Rule 5): the count means different things
-- per job (words / slides / pages / weight% / copies). The math was always
-- rate × count, but nothing recorded WHAT the count is. This optional free-text
-- label makes "6 slides @ 100" vs "2000 words @ 2" explicit on the grid. Additive;
-- existing rows are null (render as a plain count). work_line is mutable master
-- data (not the append-only ledger), so no grant change.
alter table work_line add column if not exists unit_label text;
