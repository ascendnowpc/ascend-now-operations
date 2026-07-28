-- Homework Generator — manual photo/PDF answers + teacher annotation grading.
--
-- Lets a student answer a subjective question (short_answer/structured/
-- extended_response/essay/criterion) with an uploaded photo instead of typing,
-- OR attach one whole-paper PDF covering all of their subjective answers at
-- once (objective mcq/true_false/fill_blank questions are unaffected either
-- way — those stay typed + auto-graded). Neither is AI-graded: the teacher
-- opens the photo/PDF on the review page, drops text comments anywhere on it,
-- and enters the mark by hand.
--
-- Per-question photo answers reuse the existing `submissions.answers_json` /
-- `grades.per_question_json` jsonb columns (HomeworkAnswer gains a photo
-- variant; QuestionGrade gains graded_by:'manual' + an annotations array) —
-- no schema change needed for those. The whole-paper case has no single
-- question to attach to, so it gets one new jsonb column on each table.

alter table public.submissions
  add column if not exists whole_paper_answer jsonb;

comment on column public.submissions.whole_paper_answer is
  'Set when the student attaches one PDF covering their whole worked solution instead of answering subjective questions individually: { file_url, file_name }. Objective (mcq/true_false/fill_blank) questions are still answered normally in answers_json regardless.';

alter table public.grades
  add column if not exists whole_paper_grade jsonb;

comment on column public.grades.whole_paper_grade is
  'Set by grade-homework-submission (as a pending placeholder) when submissions.whole_paper_answer is present: { awarded, max, annotations: [{ id, page, x, y, text }] }. max defaults to the combined marks of every subjective question on the paper; the teacher enters awarded (and may edit max) by hand on the review page — never AI-graded.';

-- Private bucket for a student's own uploaded answer photos/PDFs. Same shape
-- as the report-cards bucket (student self-upload, scoped to their own
-- students.id folder) plus staff read access mirroring homework-content's
-- "any staff can read" policy, since a paper's owning teacher/coach/admin
-- needs to open a submitted answer to grade it.
insert into storage.buckets (id, name, public)
values ('homework-answers', 'homework-answers', false)
on conflict (id) do nothing;

drop policy if exists "Admins manage homework answers" on storage.objects;
create policy "Admins manage homework answers"
  on storage.objects for all
  using (bucket_id = 'homework-answers' and public.is_admin())
  with check (bucket_id = 'homework-answers' and public.is_admin());

drop policy if exists "Students can upload their own homework answers" on storage.objects;
create policy "Students can upload their own homework answers"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'homework-answers'
    and exists (
      select 1 from public.students s
      where s.user_id = (select auth.uid())
        and (storage.foldername(name))[1] = s.id
    )
  );

drop policy if exists "Students can read their own homework answers" on storage.objects;
create policy "Students can read their own homework answers"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'homework-answers'
    and exists (
      select 1 from public.students s
      where s.user_id = (select auth.uid())
        and (storage.foldername(name))[1] = s.id
    )
  );

drop policy if exists "Staff read homework answers" on storage.objects;
create policy "Staff read homework answers"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'homework-answers' and exists (
    select 1 from public.teachers t where t.user_id = (select auth.uid())
  ));
