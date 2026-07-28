-- Subject Notes — teacher/PC-authored notes attached to a student + subject.
--
-- A teacher (or performance coach) can file a named note against any subject
-- they teach a given student — a short text note and/or an uploaded file in any
-- format (PDF, DOCX, image, …). The student sees these notes alongside that
-- subject's session logs on their dashboard Overview tab (the same
-- subject_id + curriculum_id key the Overview already drills into).
--
-- Files live in the new private `subject-notes` bucket (path
-- `<student_id>/<uuid>.<ext>`), same self-scoped shape as `homework-answers`
-- but written by staff rather than the student.

-- ============================================================================
-- subject_notes — one note filed by a teacher/PC for a student's subject
-- ============================================================================
create table public.subject_notes (
  id bigint generated always as identity primary key,
  student_id text not null references public.students(id),
  teacher_id bigint not null references public.teachers(id),
  subject_id smallint not null references public.subjects(id),
  -- Kept in lockstep with how the Overview keys a subject button
  -- (`<subject_id>:<curriculum_id>`): set for an Academic subject picked under
  -- a curriculum, null for the flat Beyond Academic / College Counselling ones.
  curriculum_id smallint references public.curricula(id),
  title text not null,
  note_text text,
  file_name text,
  -- Object path inside the `subject-notes` storage bucket. Null for a
  -- text-only note (no attachment).
  file_url text,
  file_type text,
  created_at timestamptz not null default now(),
  -- A note is worth keeping only if it carries something — a body or a file.
  constraint subject_notes_has_content check (note_text is not null or file_url is not null)
);

comment on table public.subject_notes is 'Teacher/PC-authored notes for a student + subject (a named text note and/or an uploaded file in any format), surfaced to the student alongside that subject''s session logs on the Overview tab.';

create index subject_notes_student_id_idx on public.subject_notes(student_id);
create index subject_notes_teacher_id_idx on public.subject_notes(teacher_id);
create index subject_notes_subject_id_idx on public.subject_notes(subject_id);

alter table public.subject_notes enable row level security;

create policy "Admins can manage all subject_notes"
  on public.subject_notes for all
  using (is_admin())
  with check (is_admin());

create policy "Teachers manage their own subject_notes"
  on public.subject_notes for all
  using (teacher_id = my_teacher_id())
  with check (teacher_id = my_teacher_id());

create policy "Performance coaches can manage all subject_notes"
  on public.subject_notes for all
  using (is_performance_coach())
  with check (is_performance_coach());

create policy "Students can read their own subject_notes"
  on public.subject_notes for select
  using (can_view_student(student_id));

grant select, insert, update, delete on table public.subject_notes to authenticated;
grant all on table public.subject_notes to service_role;
grant usage on sequence public.subject_notes_id_seq to authenticated, service_role;

-- ============================================================================
-- subject-notes storage bucket — a note's uploaded file (any format)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('subject-notes', 'subject-notes', false)
on conflict (id) do nothing;

drop policy if exists "Admins manage subject notes files" on storage.objects;
create policy "Admins manage subject notes files"
  on storage.objects for all
  using (bucket_id = 'subject-notes' and public.is_admin())
  with check (bucket_id = 'subject-notes' and public.is_admin());

-- Staff (any teacher/coach) can upload, namespaced under a real student id
-- folder — mirrors the homework-content upload policy.
drop policy if exists "Staff upload subject notes files" on storage.objects;
create policy "Staff upload subject notes files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'subject-notes'
    and exists (select 1 from public.teachers t where t.user_id = (select auth.uid()))
    and exists (select 1 from public.students s where s.id = (storage.foldername(name))[1])
  );

drop policy if exists "Staff read subject notes files" on storage.objects;
create policy "Staff read subject notes files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'subject-notes' and exists (
    select 1 from public.teachers t where t.user_id = (select auth.uid())
  ));

-- A teacher/coach can remove a file they no longer want (e.g. deleting a note).
drop policy if exists "Staff delete subject notes files" on storage.objects;
create policy "Staff delete subject notes files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'subject-notes' and exists (
    select 1 from public.teachers t where t.user_id = (select auth.uid())
  ));

-- Students read only files under their own student-id folder.
drop policy if exists "Students read their own subject notes files" on storage.objects;
create policy "Students read their own subject notes files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'subject-notes'
    and exists (
      select 1 from public.students s
      where s.user_id = (select auth.uid())
        and (storage.foldername(name))[1] = s.id
    )
  );
