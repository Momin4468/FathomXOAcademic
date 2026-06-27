-- ============================================================================
-- 0012_expense_task_nodelete.sql — tighten grants (review N6). No code path
-- hard-deletes expenses/tasks (expense soft-deletes via archived_at; tasks use
-- state='cancelled'), so revoke DELETE to honour the "never hard-delete" intent
-- (SCHEMA §Conventions). Keeps select/insert/update.
-- ============================================================================

revoke delete on expense from app_user;
revoke delete on task from app_user;
