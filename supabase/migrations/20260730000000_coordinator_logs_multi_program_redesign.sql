-- Coordinator Logs redesign:
--   1. "Type of program" becomes multi-select — replace the single course_type_id
--      FK with a course_type_ids smallint[] array (a check-in can now cover several
--      programs at once, e.g. Academic + Beyond Academic, or a bundle like
--      All-In-One). No FK is possible on array elements; course types are
--      soft-deleted (is_active) rather than removed, so integrity is fine.
--   2. Remove the "Ideal Outcome — By When" field entirely.
--
-- Applied live via Supabase MCP apply_migration (tracked version 20260715121507);
-- this file keeps the repo's supabase/migrations history in dependency order
-- (it alters the table created in 20260729000000_coordinator_logs.sql).

-- --- 1. Multiple programs ---------------------------------------------------
alter table public.coordinator_logs
  add column course_type_ids smallint[] not null default '{}';

update public.coordinator_logs
  set course_type_ids = array[course_type_id]::smallint[]
  where course_type_id is not null;

alter table public.coordinator_logs
  drop constraint coordinator_logs_course_type_id_fkey;
alter table public.coordinator_logs
  drop column course_type_id;

create index coordinator_logs_course_type_ids_idx
  on public.coordinator_logs using gin (course_type_ids);

comment on column public.coordinator_logs.course_type_ids is
  'Programs this check-in covers (course_types.id[]). Multi-select — drives which subject / profile-building blocks the form shows. No FK: course types are soft-deleted, not removed.';

-- --- 2. Drop "ideal outcome by when" ---------------------------------------
alter table public.coordinator_logs
  drop constraint coordinator_logs_month_dates_check;
alter table public.coordinator_logs
  drop column ideal_outcome_by_when;
alter table public.coordinator_logs
  add constraint coordinator_logs_month_dates_check check (
    (goal_timeline is null or extract(day from goal_timeline) = 1) and
    (upsell_timing is null or extract(day from upsell_timing) = 1)
  );
