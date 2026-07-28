-- The session-logging form auto-fills/scopes the "Coordinator (performance
-- coach)" field to a student's actual assigned PC (see getPcForStudent in
-- src/hooks/usePcAssignments.ts), but the only SELECT policy on
-- pc_student_assignments was "pc_read_own_assignments" — a PC could only
-- read rows where they themselves are the assigned coach. Any other
-- teacher (or a PC logging a session for a student assigned to a
-- *different* PC) got zero rows back, so the field silently fell back to
-- showing every coach unfiltered with nothing pre-selected.
--
-- This mirrors the existing broad-read pattern already used for
-- students/teachers/program_types: any authenticated teacher can see who a
-- student's active coach is, without being able to see unassignment
-- history for students that aren't their own.
CREATE POLICY "teachers_read_active_pc_assignments" ON public.pc_student_assignments FOR SELECT
  USING (
    unassigned_at IS NULL
    AND EXISTS (SELECT 1 FROM public.teachers WHERE teachers.user_id = auth.uid())
  );
