-- =========================================================
-- db/scripts/add-teacher-subjects.sql
-- =========================================================
-- Bulk-assigns subjects to teachers via teacher_subjects.
--
-- HOW TO USE:
--   1. Edit the VALUES list below — one row per (teacher, subject)
--      assignment you want to add.
--        - teacher_email:   must match teachers.email exactly
--        - subject_name:    must match subjects.name exactly
--        - curriculum_name: must match curricula.name exactly,
--                            or NULL for a Beyond Academics subject
--   2. Run in the Supabase SQL Editor (postgres / service role).
--
-- SAFE TO RE-RUN: rows that are already assigned are skipped
-- (matches the existing teacher_subjects_academic_uq /
-- teacher_subjects_non_academic_uq unique indexes), so running
-- this twice will not create duplicates.
-- =========================================================

INSERT INTO public.teacher_subjects (teacher_id, subject_id, curriculum_id)
SELECT
  t.id,
  s.id,
  c.id
FROM (VALUES
  -- (teacher_email, subject_name, curriculum_name)
  -- Example rows — replace with your own:
  ('james.wilson@ascendnow.com',  'Mathematics',         'IBDP'),
  ('james.wilson@ascendnow.com',  'Physics',             'IBDP'),
  ('priya.sharma@ascendnow.com',  'College Counselling', NULL)

) AS pairs (teacher_email, subject_name, curriculum_name)
JOIN      public.teachers  t ON t.email  = pairs.teacher_email
JOIN      public.subjects  s ON s.name   = pairs.subject_name
LEFT JOIN public.curricula c ON c.name   = pairs.curriculum_name
WHERE NOT EXISTS (
  SELECT 1 FROM public.teacher_subjects ts
  WHERE ts.teacher_id    = t.id
    AND ts.subject_id    = s.id
    AND ts.curriculum_id IS NOT DISTINCT FROM c.id
);

-- =========================================================
-- VERIFY
-- =========================================================
-- SELECT t.first_name, t.last_name, s.name AS subject, cu.name AS curriculum
-- FROM   public.teacher_subjects ts
-- JOIN   public.teachers  t  ON t.id  = ts.teacher_id
-- JOIN   public.subjects  s  ON s.id  = ts.subject_id
-- LEFT JOIN public.curricula cu ON cu.id = ts.curriculum_id
-- ORDER BY t.first_name, s.name;
