-- The parent's Profile page shows each linked child's username (so a parent
-- can see everything about their child's account in one place), but nothing
-- previously let a parent read a `users` row other than their own — only
-- admin and performance coaches could. Add a read-only SELECT scoped to a
-- parent's own linked children, same scoping pattern as `can_view_student()`
-- but expressed directly (no cross-table recursion risk: `users`' own
-- policies never subquery `students`/`parents`, so this can't create the
-- same recursion class fixed in 20260707000000).
create policy "parents_read_children_users"
  on public.users for select
  using (
    id in (
      select s.user_id from public.students s
      join public.parents p on p.id = s.parent_id
      where p.user_id = auth.uid() and s.user_id is not null
    )
  );
