-- Add "Career Exploration - CC" as a College Counselling subject (2026-07-28)
--
-- Per db/docs/SUBJECT_HIERARCHY.md §3b, a new College Counselling subject is
-- just a plain active `subjects` row with category_id = NULL and
-- category = 'college_counselling' -- no grouping, no program_type/course_type
-- of its own. It shows up automatically in the flat College Counselling
-- subject picker (BeyondAcademicSubjectSelect, reused) with no code change.
--
-- Named "Career Exploration - CC" rather than plain "Career Exploration" to
-- stay distinct from the existing Beyond Academic subject of that name
-- (id 607, category = 'beyond_academic') -- the two are separate offerings
-- billed under different course types.
INSERT INTO public.subjects (name, category, category_id, is_active, sort_order)
SELECT 'Career Exploration - CC', 'college_counselling', NULL, true, 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.subjects
  WHERE name = 'Career Exploration - CC' AND category = 'college_counselling'
);
