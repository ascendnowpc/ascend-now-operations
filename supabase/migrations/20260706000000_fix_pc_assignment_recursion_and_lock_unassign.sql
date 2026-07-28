-- Fix two problems with the pc_student_assignments RLS policies.
--
-- 1) INFINITE RECURSION on assigning a student
--    ------------------------------------------------------------------
--    The INSERT policy `pc_assign_unassigned_student_to_self` guarded
--    against double-assigning a student by inlining a subquery that reads
--    pc_student_assignments *from within a policy on pc_student_assignments*:
--
--        NOT EXISTS (SELECT 1 FROM pc_student_assignments existing
--                     WHERE existing.student_id = pc_student_assignments.student_id
--                       AND existing.unassigned_at IS NULL)
--
--    Evaluating that subquery re-applies RLS on the same table, which
--    re-evaluates the policy, which runs the subquery again — Postgres
--    detects the loop and aborts every PC assign with
--    "infinite recursion detected in policy for relation
--    pc_student_assignments" (from /teacher/students "+ Assign student"
--    and /admin/pc-assignments alike).
--
--    Fix: move the "does this student already have an active coach?" check
--    into a SECURITY DEFINER helper. The table is not FORCE ROW LEVEL
--    SECURITY, so a definer-owned function reads it without re-triggering
--    RLS, breaking the loop. This mirrors is_admin()/can_view_student()
--    and preserves the exact same guard (which the unique index
--    uq_active_pc_per_student also enforces as a hard backstop).
--
-- 2) ONLY ADMINS MAY UNASSIGN A STUDENT FROM A COACH
--    ------------------------------------------------------------------
--    Performance coaches must NOT be able to remove/unassign their own
--    students — that's an admin-only action. Drop the PC UPDATE policy
--    `pc_unassign_own_students`; admins keep full control via
--    `admin_all_pc_assignments`. PC self-assign of an UNASSIGNED student
--    (an INSERT) is unaffected.

-- 1) Recursion-safe existence check ------------------------------------
create or replace function public.student_has_active_pc(p_student_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.pc_student_assignments
    where student_id = p_student_id
      and unassigned_at is null
  );
$$;

grant execute on function public.student_has_active_pc(text) to authenticated;

drop policy if exists pc_assign_unassigned_student_to_self on public.pc_student_assignments;
create policy pc_assign_unassigned_student_to_self
  on public.pc_student_assignments
  for insert
  to public
  with check (
    is_performance_coach()
    and pc_teacher_id = my_teacher_id()
    and not public.student_has_active_pc(student_id)
  );

-- 2) Remove the PC's ability to unassign -------------------------------
drop policy if exists pc_unassign_own_students on public.pc_student_assignments;
