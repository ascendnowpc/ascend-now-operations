-- Gate grade visibility behind an explicit teacher publish action, mirroring
-- the existing generated_papers draft->published gate. Previously
-- grade-homework-submission wrote AI/auto marks straight into `grades`, and
-- "Students can read their own grades" let the student see them immediately
-- (no review step). Now a teacher must click "Publish grade" on the review
-- page before the student can see it at all.

alter table public.grades
  add column published_at timestamptz,
  add column published_by_teacher_id bigint references public.teachers(id);

comment on column public.grades.published_at is 'Set when the paper-owning teacher explicitly publishes this grade to the student, after reviewing/overriding AI marks. Null = not yet visible to the student, regardless of grading status.';
comment on column public.grades.published_by_teacher_id is 'Teacher who published this grade to the student.';

drop policy "Students can read their own grades" on public.grades;

create policy "Students can read their own published grades"
  on public.grades for select
  using (
    published_at is not null
    and exists (
      select 1 from public.submissions s
      where s.id = grades.submission_id and can_view_student(s.student_id)
    )
  );
