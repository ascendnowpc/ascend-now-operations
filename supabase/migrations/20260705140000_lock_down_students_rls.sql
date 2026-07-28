-- Real security gap, found during a full-codebase RLS audit: `students` was
-- the ONLY table in the entire schema with unrestricted RLS. All three of
-- its policies were `USING (true)` / `WITH CHECK (true)` scoped to role
-- `authenticated` -- meaning ANY logged-in user (a student, a parent, any
-- teacher) could, via a direct API call bypassing the UI entirely:
--   - read every other student's full PII (name, email, phone, address,
--     parent info), not just their own or their assigned ones
--   - update any student's row, including reassigning parent_id to a
--     different family
--   - insert fake student rows directly
-- There was also no admin ALL policy on this table at all -- the "Admins can
-- do everything" pattern used consistently elsewhere in this schema was
-- missing here, with admin actions instead riding on the same blanket
-- authenticated-role policies as everyone else.
--
-- Checked every actual write path before tightening this:
--   - The only client-side UPDATE is `StudentDetailView.tsx`'s saveContact(),
--     already gated in the UI to admin only (`isAdmin` — see that
--     component's header comment).
--   - `useStudents.ts`'s `updateStudent()` helper exists but is never called
--     anywhere in the app (dead code, left alone here).
--   - The only INSERT is the enrollment-confirm edge function
--     (`review-enrollment-payment`), which runs as `service_role` and is
--     unaffected by RLS regardless of these policies.
--   - Broad SELECT is genuinely needed by staff: any teacher (not just a
--     performance coach) needs to search/pick any student when logging a
--     session (`StudentSearch`, `TeacherSessionFormPage.tsx` — only a PC's
--     search is client-side scoped via `allowedIds`, per the design already
--     documented for `StudentsListView.tsx`). Admin pages (Analysis, Reports,
--     Packages) also need every student.
--
-- New model: admins get full access via the standard ALL policy; any staff
-- member (a row in `teachers`, which includes performance coaches and plain
-- teachers alike) can SELECT every student, matching what the app already
-- relies on; a student can read their own row and a parent their linked
-- children's rows via the existing `can_view_student()` helper. Nobody
-- except admin can INSERT/UPDATE/DELETE anymore -- matching what the UI
-- already only ever let admin do.

DROP POLICY "Authenticated users can insert students" ON public.students;
DROP POLICY "Authenticated users can read students" ON public.students;
DROP POLICY "Authenticated users can update students" ON public.students;

CREATE POLICY "Admins can do everything on students" ON public.students
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Staff can read all students" ON public.students
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.teachers WHERE teachers.user_id = auth.uid())
  );

CREATE POLICY "student_parent_read_students" ON public.students
  FOR SELECT USING (public.can_view_student(id));
