-- Bug caught in live testing right after the 2026-07-06 first-login
-- profile-completion migration: saving the mandatory profile form as a
-- student raised "infinite recursion detected in policy for relation
-- students". Root cause: `parents_update_own_children` (UPDATE policy on
-- `students`) subqueries `parents` directly, and `parents`' own
-- `pc_read_assigned_parents` (SELECT policy) subqueries back into
-- `students`+`pc_student_assignments` — any UPDATE on `students` has to
-- evaluate every UPDATE policy on the table, so planning
-- `parents_update_own_children` pulls in `parents`' RLS, which pulls
-- `students`' RLS again, looping forever. Same class of bug already fixed
-- once for `pc_student_assignments` (see student_has_active_pc() and its
-- migration) — the fix is the same: move the cross-table check into a
-- SECURITY DEFINER helper, which runs outside RLS re-evaluation (the table
-- is not FORCE ROW LEVEL SECURITY), breaking the cycle.

create or replace function public.is_my_linked_child(p_parent_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.parents p
    where p.id = p_parent_id and p.user_id = auth.uid()
  );
$$;

drop policy if exists "parents_update_own_children" on public.students;

create policy "parents_update_own_children"
  on public.students for update
  using (public.is_my_linked_child(parent_id))
  with check (public.is_my_linked_child(parent_id));
