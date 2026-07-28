-- Performance coaches are no longer allowed to assign students to themselves.
-- Assigning/unassigning a student to/from a coach is now an admin-only action
-- (done from /admin/pc-assignments). The UI's "+ Assign student" self-service
-- flow on /teacher/students has been removed; drop the matching INSERT policy so
-- the rule is enforced at the DB layer too, not just in the app.
--
-- The PC UPDATE (unassign) policy was already removed in an earlier change, so
-- after this a performance coach has only the read policies on this table:
--   - pc_read_own_assignments (SELECT their own assignments)
--   - teachers_read_active_pc_assignments (SELECT active assignments)
-- Admin retains full access via admin_all_pc_assignments.

drop policy if exists "pc_assign_unassigned_student_to_self" on public.pc_student_assignments;
