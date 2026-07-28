-- Add a per-subject baseline score date to coordinator_log_subjects, mirroring
-- how each current grade already carries the log_date it was recorded on. The
-- Performance Coach records when the baseline was measured, shown alongside the
-- baseline score in the form and every read view. Academic subjects only
-- (Beyond Academic / College Counselling picks carry no baseline at all).
alter table public.coordinator_log_subjects
  add column if not exists baseline_score_date date;

comment on column public.coordinator_log_subjects.baseline_score_date is
  'The date the baseline score was recorded/measured (optional). Academic subjects only. Carried forward like baseline_score when a new log prefills from the latest.';
