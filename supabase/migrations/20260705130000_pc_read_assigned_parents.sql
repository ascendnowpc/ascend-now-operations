-- Bug: on the PC student-detail page, the "Parent / Guardian Account" card
-- always showed "No parent account linked yet" even when a parent account
-- was fully linked (e.g. student S1 -> parent P1). The card renders that
-- fallback whenever the `parents` fetch returns null, and it always did for
-- a PC because the `parents` table had NO row-level policy granting a
-- performance coach any read access — only `admin_all_parents` (admins) and
-- `parent_read_own` (a parent reading their own row) existed. RLS silently
-- returned zero rows, which the UI can't distinguish from "no parent".
--
-- Fix: let a PC SELECT a parent row, scoped to parents of their own
-- currently-assigned students (read-only, matching the PC's view-only access
-- to student details, and the same pc_student_assignments scoping the
-- invoices / pool-resolution PC policies already use). The parent's username
-- is read from `users`, which a PC can already read via the existing
-- "Performance coaches can read users" policy, so no change is needed there.

CREATE POLICY "pc_read_assigned_parents" ON public.parents
  FOR SELECT
  USING (
    public.is_performance_coach()
    AND id IN (
      SELECT s.parent_id
      FROM public.students s
      JOIN public.pc_student_assignments a ON a.student_id = s.id
      WHERE a.pc_teacher_id = public.my_teacher_id()
        AND a.unassigned_at IS NULL
        AND s.parent_id IS NOT NULL
    )
  );
