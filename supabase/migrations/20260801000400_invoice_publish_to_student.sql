-- Reports (invoices) are drafts by default and must be explicitly published
-- to the student before they appear on the student dashboard. Admins and PCs
-- still see every report (their own ALL policies are unaffected); only the
-- student read path is gated on publication.
alter table public.invoices
  add column if not exists published_to_student_at timestamptz,
  add column if not exists published_by_user_id uuid references public.users(id);

alter policy student_parent_read_invoices on public.invoices
  using (can_view_student(student_id) and published_to_student_at is not null);
