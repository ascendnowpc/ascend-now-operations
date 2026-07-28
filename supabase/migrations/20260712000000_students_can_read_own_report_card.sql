-- A student could upload their own report card (2026-07-11 migration) but
-- had no way to view it back afterward — createSignedUrl still needs a
-- SELECT policy on storage.objects, and only admin/staff had one. Lets a
-- student read (not update/delete) objects under their own students.id
-- folder, same scoping as the existing INSERT policy.
create policy "Students can read their own report card"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'report-cards'
    and exists (
      select 1 from public.students s
      where s.user_id = auth.uid()
        and (storage.foldername(name))[1] = s.id
    )
  );
