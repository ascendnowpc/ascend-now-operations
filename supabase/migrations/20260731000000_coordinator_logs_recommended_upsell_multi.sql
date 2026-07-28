-- Coordinator Logs: "Recommended Upsell" becomes multi-select.
--
-- The renewal-upsell automation (see the companion migration
-- 20260731000100_coordinator_logs_auto_renewal_upsell.sql) recommends *every*
-- package that has crossed 75% usage, which can be more than one at once for a
-- multi-package/bundle student. Replace the single
-- recommended_upsell_course_type_id FK with a recommended_upsell_course_type_ids
-- smallint[] array — mirrors exactly how course_type_ids replaced
-- course_type_id in 20260730000000_coordinator_logs_multi_program_redesign.sql
-- (no FK possible on array elements; course types are soft-deleted, not removed,
-- so integrity is fine).
--
-- Applied live via Supabase MCP apply_migration; this file keeps the repo's
-- supabase/migrations history in dependency order.

alter table public.coordinator_logs
  add column recommended_upsell_course_type_ids smallint[] not null default '{}';

update public.coordinator_logs
  set recommended_upsell_course_type_ids = array[recommended_upsell_course_type_id]::smallint[]
  where recommended_upsell_course_type_id is not null;

alter table public.coordinator_logs
  drop constraint coordinator_logs_recommended_upsell_course_type_id_fkey;
alter table public.coordinator_logs
  drop column recommended_upsell_course_type_id;

create index coordinator_logs_recommended_upsell_course_type_ids_idx
  on public.coordinator_logs using gin (recommended_upsell_course_type_ids);

comment on column public.coordinator_logs.recommended_upsell_course_type_ids is
  'Packages recommended for upsell (course_types.id[]) — every package/pool the student has crossed 75% usage on. Auto-filled by the renewal-upsell automation; PC/admin can override. No FK: course types are soft-deleted, not removed.';
