-- Homework Generator — Phase 3: private storage bucket for teacher content uploads.
-- Backs the `content_uploads` table (its `file_url` column stores an object path
-- in this bucket). A teacher on the Homework Generator "Upload File" content
-- source drops a PDF/PPT/DOCX here; Phase 4's parser reads it back for text
-- extraction. Same access shape as `report-cards`: admins manage everything,
-- staff (any `teachers` row) can read, and staff can upload only under a folder
-- prefixed with a student id they're allowed to write for. Students never read
-- this bucket directly — they only ever see the finished generated paper.

insert into storage.buckets (id, name, public)
values ('homework-content', 'homework-content', false)
on conflict (id) do nothing;

drop policy if exists "Admins manage homework content" on storage.objects;
create policy "Admins manage homework content"
  on storage.objects for all
  using (bucket_id = 'homework-content' and public.is_admin())
  with check (bucket_id = 'homework-content' and public.is_admin());

drop policy if exists "Staff read homework content" on storage.objects;
create policy "Staff read homework content"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'homework-content' and exists (
    select 1 from public.teachers t where t.user_id = (select auth.uid())
  ));

-- Staff upload, scoped so the path's first folder is a real student id — mirrors
-- the content_uploads.student_id FK and keeps one teacher's uploads for a student
-- namespaced under "<student_id>/…". INSERT only (no overwrite/delete for staff).
drop policy if exists "Staff upload homework content" on storage.objects;
create policy "Staff upload homework content"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'homework-content'
    and exists (select 1 from public.teachers t where t.user_id = (select auth.uid()))
    and exists (select 1 from public.students s where s.id = (storage.foldername(name))[1])
  );
