-- A College Counsellor sees only the session logs they wrote themselves.
--
-- 20260806000100 gave a CC `CCs can read sessions for assigned students`,
-- mirroring the Performance Coach policy: read every session logged for an
-- assigned student, by any teacher. That was the wrong call for this role — a
-- counsellor's business is their own counselling sessions with the student,
-- not the student's academic sessions with every other teacher. Dropping it
-- leaves the existing "Teachers can read their own session logs"
-- (`teacher_id = my_teacher_id()`) as their only read, which is exactly the
-- intended scope: their own logs, including the ones for their students.
--
-- Nothing else changes: a CC writes session logs through the same
-- teacher INSERT policy as before, and the PC's blanket read is untouched.

drop policy if exists "CCs can read sessions for assigned students" on public.session_logs;
