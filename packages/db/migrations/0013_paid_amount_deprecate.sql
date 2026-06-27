-- ============================================================================
-- 0013_paid_amount_deprecate.sql — N1: invoice_line.paid_amount is DERIVE-ONLY.
-- Paid & due are summed from payment_allocation at read time (SCHEMA §I); the
-- column is never written or read by the app and has been removed from the
-- Drizzle mirror. Kept physically for SCHEMA.md §F fidelity; this comment is the
-- DB-level signal so no future contributor "maintains" it.
-- ============================================================================

comment on column invoice_line.paid_amount is
  'DERIVE-ONLY / deprecated: paid & due are summed from payment_allocation at read time (SCHEMA §I). Never written or read by the app.';
