-- Tighten INSERT access on the shared catalogue tables (curricula, subjects).
--
-- Both tables carried a legacy "Authenticated users can insert" policy whose
-- USING/WITH CHECK was only `auth.uid() IS NOT NULL` — i.e. ANY logged-in
-- user, students and parents included, could insert rows into the shared
-- curriculum/subject catalogue. Verified live (role-impersonated a real
-- student): they could successfully insert both a curriculum and a subject.
-- This is a write-integrity gap (catalogue pollution visible to everyone via
-- the dropdowns), not a data leak, but it has no legitimate use — the only
-- real insert paths are:
--   * curricula  → the coach-only Subjects Library (`SubjectsLibraryContent`),
--     i.e. performance coaches + admins. Plain teachers never create curricula.
--   * subjects   → the coach-only library AND a plain teacher's own
--     `/teacher/subjects` page (auto-creating a subject named after an
--     ungrouped curriculum, in `TeacherSubjectEditor`). So subjects insert
--     must stay open to ANY teacher (plain or coach), but not students/parents.
--
-- Admins keep full access via their existing FOR ALL `is_admin()` policies;
-- performance coaches keep their existing dedicated insert policies.

-- curricula: drop the over-broad insert. PC + admin policies already cover
-- every legitimate insert path, so no replacement is needed.
DROP POLICY IF EXISTS "Authenticated users can insert curricula" ON public.curricula;

-- subjects: replace the over-broad insert with a teacher-scoped one. Any user
-- with a row in `teachers` (plain teacher or performance coach) may insert;
-- students/parents (no teacher row) may not. Admins/coaches remain covered by
-- their own policies too.
DROP POLICY IF EXISTS "Authenticated users can insert subjects" ON public.subjects;

CREATE POLICY "Teachers can insert subjects" ON public.subjects
  FOR INSERT
  WITH CHECK (public.my_teacher_id() IS NOT NULL);
