-- Zoom invoices are a teacher-only obligation — performance coaches must not
-- be able to create or replace one. The existing RLS only checked
-- `teacher_id = my_teacher_id()`, but a performance coach IS a teachers row
-- (is_performance_coach = true), so my_teacher_id() returned their id and the
-- INSERT/replace-UPDATE policies let them through. Enforce the teacher-only
-- rule at the DB layer (not just the UI) by adding a coach exclusion to both
-- write policies. SELECT is left unchanged: a coach seeing their own rows (of
-- which they can now create none) is harmless, and one coach-owned row
-- predates this change.

drop policy if exists "Teachers can upload their own zoom invoices" on public.zoom_invoices;
create policy "Teachers can upload their own zoom invoices" on public.zoom_invoices
  for insert
  with check (
    teacher_id = public.my_teacher_id()
    and not exists (
      select 1 from public.teachers t
      where t.id = teacher_id and t.is_performance_coach
    )
  );

drop policy if exists "Teachers can replace their own pending zoom invoices" on public.zoom_invoices;
create policy "Teachers can replace their own pending zoom invoices" on public.zoom_invoices
  for update
  using (
    teacher_id = public.my_teacher_id()
    and status = 'pending'::text
    and not exists (
      select 1 from public.teachers t
      where t.id = teacher_id and t.is_performance_coach
    )
  )
  with check (
    teacher_id = public.my_teacher_id()
    and status = 'pending'::text
    and not exists (
      select 1 from public.teachers t
      where t.id = teacher_id and t.is_performance_coach
    )
  );
