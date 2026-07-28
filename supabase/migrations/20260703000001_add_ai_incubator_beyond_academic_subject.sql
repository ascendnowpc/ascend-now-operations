-- Add "AI Incubator" as a Beyond Academic subject (2026-07-03)
--
-- Per db/docs/SUBJECT_HIERARCHY.md §3, a new Beyond Academic subject is just
-- a plain active `subjects` row with category_id = NULL and a non-'academic'
-- `category` label — no grouping, no program_type/course_type of its own. It
-- then shows up automatically in the flat Beyond Academic subject picker
-- (BeyondAcademicSubjectSelect) with no code change.
insert into public.subjects (name, category, category_id, is_active, sort_order)
select 'AI Incubator', 'beyond_academic', null, true, 2
where not exists (
  select 1 from public.subjects
  where name = 'AI Incubator' and category <> 'academic'
);
