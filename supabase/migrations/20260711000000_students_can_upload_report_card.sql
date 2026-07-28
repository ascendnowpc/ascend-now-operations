-- Lets a logged-in student upload their own report card from the
-- mandatory first-login "Complete your profile" form (or their ongoing
-- Profile page) — previously only admins could write to the private
-- report-cards bucket. Scoped to a path prefixed with the student's own
-- id (e.g. "S42/<uuid>.pdf") so a student can only ever create objects
-- under their own folder, never another student's or overwrite/delete
-- anything (INSERT only).
create policy "Students can upload their own report card"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'report-cards'
    and exists (
      select 1 from public.students s
      where s.user_id = auth.uid()
        and (storage.foldername(name))[1] = s.id
    )
  );
