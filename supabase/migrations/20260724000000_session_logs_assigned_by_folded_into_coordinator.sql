-- assigned_by_teacher_id (added in 20260723000000) is folded back into the
-- existing coordinator_teacher_id column instead: Ascend Offline Work has no
-- real "coordinator" concept, and coordinator_teacher_id is already surfaced
-- everywhere (session-log list/CSV/detail views) without needing separate
-- UI, unlike the standalone column. Backfill first so no data is lost, then
-- drop the column and its index.
UPDATE public.session_logs
SET coordinator_teacher_id = assigned_by_teacher_id
WHERE assigned_by_teacher_id IS NOT NULL
  AND coordinator_teacher_id IS NULL;

DROP INDEX IF EXISTS public.idx_session_logs_assigned_by_teacher_id;

ALTER TABLE public.session_logs
  DROP COLUMN assigned_by_teacher_id;
