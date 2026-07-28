-- Ascend Offline Work sessions need to record which teacher assigned the
-- offline work (distinct from `teacher_id`, who performed/logged it, and
-- `coordinator_teacher_id`, the student's PC). Nullable and only ever set
-- for the `ascend_offline_work` program type — see SessionLogFormView.tsx.
ALTER TABLE public.session_logs
  ADD COLUMN assigned_by_teacher_id bigint REFERENCES public.teachers(id);

CREATE INDEX idx_session_logs_assigned_by_teacher_id
  ON public.session_logs USING btree (assigned_by_teacher_id);
