-- Homework Generator — Phase 1 data layer (see docs/homework-generator-architecture.md)
-- Adds the tables needed to generate, publish, attempt, and grade homework papers.
-- No application code wired up yet — this is schema only (style templates get seeded
-- in a follow-up migration; generation/grading services land in later phases).

-- ============================================================================
-- style_templates — per exam-board/question-type prompt fragments
-- ============================================================================
create table public.style_templates (
  id smallint generated always as identity primary key,
  code text not null unique,
  name text not null,
  board text,
  question_type text not null,
  prompt_fragment text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.style_templates is 'Per exam-board/question-type prompt fragments (IBDP Section A, IGCSE Extended, MCQ, ...) used by the Homework Generator to shape generated questions: format, command-word conventions, mark-scheme structure, expected length.';

alter table public.style_templates enable row level security;

create policy "Admins can manage all style_templates"
  on public.style_templates for all
  using (is_admin())
  with check (is_admin());

create policy "Staff can read active style_templates"
  on public.style_templates for select
  using (is_active and exists (select 1 from public.teachers where teachers.user_id = auth.uid()));

grant select, insert, update, delete on table public.style_templates to authenticated;
grant all on table public.style_templates to service_role;
grant usage on sequence public.style_templates_id_seq to authenticated, service_role;

-- ============================================================================
-- content_uploads — teacher-uploaded source material (PDF/PPT/DOCX)
-- ============================================================================
create table public.content_uploads (
  id bigint generated always as identity primary key,
  student_id text not null references public.students(id),
  uploaded_by_teacher_id bigint not null references public.teachers(id),
  file_name text not null,
  file_url text not null,
  file_type text not null check (file_type in ('pdf', 'ppt', 'pptx', 'docx')),
  parsed_text text,
  parse_status text not null default 'pending' check (parse_status in ('pending', 'processing', 'completed', 'failed')),
  parse_error text,
  created_at timestamptz not null default now()
);

comment on table public.content_uploads is 'Teacher-uploaded chapter/slide/notes files used as Homework Generator source content, parsed asynchronously into parsed_text.';

create index content_uploads_student_id_idx on public.content_uploads(student_id);
create index content_uploads_uploaded_by_teacher_id_idx on public.content_uploads(uploaded_by_teacher_id);

alter table public.content_uploads enable row level security;

create policy "Admins can manage all content_uploads"
  on public.content_uploads for all
  using (is_admin())
  with check (is_admin());

create policy "Teachers manage their own content_uploads"
  on public.content_uploads for all
  using (uploaded_by_teacher_id = my_teacher_id())
  with check (uploaded_by_teacher_id = my_teacher_id());

create policy "Performance coaches can read all content_uploads"
  on public.content_uploads for select
  using (is_performance_coach());

grant select, insert, update, delete on table public.content_uploads to authenticated;
grant all on table public.content_uploads to service_role;
grant usage on sequence public.content_uploads_id_seq to authenticated, service_role;

-- ============================================================================
-- generated_papers — a homework paper generated for one student
-- ============================================================================
create table public.generated_papers (
  id bigint generated always as identity primary key,
  student_id text not null references public.students(id),
  created_by_teacher_id bigint not null references public.teachers(id),
  subject_id smallint references public.subjects(id),
  curriculum_id smallint references public.curricula(id),
  content_source_type text not null check (content_source_type in ('session_log', 'upload', 'both')),
  session_log_id bigint references public.session_logs(id),
  content_upload_id bigint references public.content_uploads(id),
  blocks jsonb not null,
  difficulty text not null default 'standard' check (difficulty in ('standard', 'scaffolded', 'stretch', 'eal')),
  questions_json jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'in_progress', 'submitted', 'graded')),
  generation_error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generated_papers_source_check check (
    (content_source_type = 'session_log' and session_log_id is not null)
    or (content_source_type = 'upload' and content_upload_id is not null)
    or (content_source_type = 'both' and session_log_id is not null and content_upload_id is not null)
  )
);

comment on table public.generated_papers is 'One generated homework paper: its composition blocks (question count + style template per block), the generated question/answer JSON, and its draft->published->in_progress->submitted->graded lifecycle status.';
comment on column public.generated_papers.blocks is 'Requested composition, e.g. [{"count":4,"style":"IBDP_SECTION_A"},{"count":5,"style":"MCQ"}].';
comment on column public.generated_papers.questions_json is 'Generated paper content: questions, correct answers/mark scheme, per Teacher Answer Sheet + Student Question Sheet views.';

create index generated_papers_student_id_idx on public.generated_papers(student_id);
create index generated_papers_created_by_teacher_id_idx on public.generated_papers(created_by_teacher_id);
create index generated_papers_status_idx on public.generated_papers(status);
create index generated_papers_session_log_id_idx on public.generated_papers(session_log_id);
create index generated_papers_content_upload_id_idx on public.generated_papers(content_upload_id);

create trigger generated_papers_touch_updated_at
  before update on public.generated_papers
  for each row execute function public.touch_updated_at();

alter table public.generated_papers enable row level security;

create policy "Admins can manage all generated_papers"
  on public.generated_papers for all
  using (is_admin())
  with check (is_admin());

create policy "Teachers manage their own generated_papers"
  on public.generated_papers for all
  using (created_by_teacher_id = my_teacher_id())
  with check (created_by_teacher_id = my_teacher_id());

create policy "Performance coaches can manage all generated_papers"
  on public.generated_papers for all
  using (is_performance_coach())
  with check (is_performance_coach());

create policy "Students can read their own published papers"
  on public.generated_papers for select
  using (can_view_student(student_id) and status <> 'draft');

grant select, insert, update, delete on table public.generated_papers to authenticated;
grant all on table public.generated_papers to service_role;
grant usage on sequence public.generated_papers_id_seq to authenticated, service_role;

-- ============================================================================
-- question_bank — deduped generated questions, tagged by topic/style/difficulty
-- ============================================================================
create table public.question_bank (
  id bigint generated always as identity primary key,
  paper_id bigint references public.generated_papers(id),
  style_template_id smallint references public.style_templates(id),
  subject_id smallint references public.subjects(id),
  curriculum_id smallint references public.curricula(id),
  topic text,
  difficulty text,
  question_text text not null,
  question_hash text not null,
  answer_json jsonb,
  created_at timestamptz not null default now()
);

comment on table public.question_bank is 'Generated questions kept for dedup checks (question_hash) against future generation requests, tagged by topic/style/difficulty.';

create index question_bank_question_hash_idx on public.question_bank(question_hash);
create index question_bank_paper_id_idx on public.question_bank(paper_id);

alter table public.question_bank enable row level security;

create policy "Admins can manage all question_bank"
  on public.question_bank for all
  using (is_admin())
  with check (is_admin());

create policy "Staff can read question_bank"
  on public.question_bank for select
  using (exists (select 1 from public.teachers where teachers.user_id = auth.uid()));

create policy "Staff can insert question_bank"
  on public.question_bank for insert
  with check (exists (select 1 from public.teachers where teachers.user_id = auth.uid()));

grant select, insert, update, delete on table public.question_bank to authenticated;
grant all on table public.question_bank to service_role;
grant usage on sequence public.question_bank_id_seq to authenticated, service_role;

-- ============================================================================
-- submissions — a student's in-progress or submitted answers to a paper
-- ============================================================================
create table public.submissions (
  id bigint generated always as identity primary key,
  paper_id bigint not null unique references public.generated_papers(id),
  student_id text not null references public.students(id),
  answers_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  submitted_at timestamptz
);

comment on table public.submissions is 'One per generated_papers row (unique on paper_id) — the student''s answers, saved incrementally until submitted_at is set.';

create index submissions_student_id_idx on public.submissions(student_id);

alter table public.submissions enable row level security;

create policy "Admins can manage all submissions"
  on public.submissions for all
  using (is_admin())
  with check (is_admin());

create policy "Students manage their own submissions"
  on public.submissions for all
  using (can_view_student(student_id))
  with check (can_view_student(student_id));

create policy "Teachers can read submissions for their own papers"
  on public.submissions for select
  using (exists (
    select 1 from public.generated_papers gp
    where gp.id = submissions.paper_id and gp.created_by_teacher_id = my_teacher_id()
  ));

create policy "Performance coaches can read all submissions"
  on public.submissions for select
  using (is_performance_coach());

grant select, insert, update, delete on table public.submissions to authenticated;
grant all on table public.submissions to service_role;
grant usage on sequence public.submissions_id_seq to authenticated, service_role;

-- Once a student has submitted, the row is immutable to them (grading happens in
-- the separate `grades` table) — only an admin can still touch it.
create or replace function public.prevent_submission_edit_after_submit()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if old.submitted_at is not null and not public.is_admin() then
    raise exception 'This homework has already been submitted and can no longer be edited.';
  end if;
  return new;
end;
$$;

create trigger submissions_lock_after_submit
  before update on public.submissions
  for each row execute function public.prevent_submission_edit_after_submit();

-- ============================================================================
-- grades — per-submission marks (auto + LLM), with teacher override
-- ============================================================================
create table public.grades (
  id bigint generated always as identity primary key,
  submission_id bigint not null unique references public.submissions(id),
  per_question_json jsonb not null default '{}'::jsonb,
  total_marks numeric,
  max_marks numeric,
  graded_at timestamptz,
  teacher_reviewed_by bigint references public.teachers(id),
  teacher_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.grades is 'Auto-graded (MCQ/fill-blank) + LLM-graded (subjective) marks for a submission, one row per submission, with space for a teacher override per question.';
comment on column public.grades.per_question_json is 'Per-question breakdown: marks awarded, max marks, AI feedback, and any teacher_override value/note.';

alter table public.grades enable row level security;

create policy "Admins can manage all grades"
  on public.grades for all
  using (is_admin())
  with check (is_admin());

create policy "Teachers manage grades for their own papers"
  on public.grades for all
  using (exists (
    select 1 from public.submissions s
    join public.generated_papers gp on gp.id = s.paper_id
    where s.id = grades.submission_id and gp.created_by_teacher_id = my_teacher_id()
  ))
  with check (exists (
    select 1 from public.submissions s
    join public.generated_papers gp on gp.id = s.paper_id
    where s.id = grades.submission_id and gp.created_by_teacher_id = my_teacher_id()
  ));

create policy "Performance coaches can manage all grades"
  on public.grades for all
  using (is_performance_coach())
  with check (is_performance_coach());

create policy "Students can read their own grades"
  on public.grades for select
  using (exists (
    select 1 from public.submissions s
    where s.id = grades.submission_id and can_view_student(s.student_id)
  ));

grant select, insert, update, delete on table public.grades to authenticated;
grant all on table public.grades to service_role;
grant usage on sequence public.grades_id_seq to authenticated, service_role;

-- ============================================================================
-- session_insights — topics/misconceptions/mastery extracted from a session log
-- ============================================================================
create table public.session_insights (
  id bigint generated always as identity primary key,
  session_log_id bigint not null unique references public.session_logs(id),
  topics_covered jsonb,
  misconceptions jsonb,
  mastery_scores jsonb,
  created_at timestamptz not null default now()
);

comment on table public.session_insights is 'Structured extraction from a session_logs row (topics covered, misconceptions, mastery scores) used to steer Homework Generator content selection.';

alter table public.session_insights enable row level security;

create policy "Admins can manage all session_insights"
  on public.session_insights for all
  using (is_admin())
  with check (is_admin());

create policy "Teachers can read insights for their own sessions"
  on public.session_insights for select
  using (exists (
    select 1 from public.session_logs sl
    where sl.id = session_insights.session_log_id and sl.teacher_id = my_teacher_id()
  ));

create policy "Performance coaches can read all session_insights"
  on public.session_insights for select
  using (is_performance_coach());

grant select, insert, update, delete on table public.session_insights to authenticated;
grant all on table public.session_insights to service_role;
grant usage on sequence public.session_insights_id_seq to authenticated, service_role;
