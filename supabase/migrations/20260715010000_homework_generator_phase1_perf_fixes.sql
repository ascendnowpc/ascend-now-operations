-- Homework Generator — Phase 1 follow-up: address performance-advisor findings
-- flagged immediately after 20260715000000 (missing FK-covering indexes, and two
-- RLS policies re-evaluating auth.uid() per row instead of once per statement).

create index generated_papers_subject_id_idx on public.generated_papers(subject_id);
create index generated_papers_curriculum_id_idx on public.generated_papers(curriculum_id);
create index question_bank_style_template_id_idx on public.question_bank(style_template_id);
create index question_bank_subject_id_idx on public.question_bank(subject_id);
create index question_bank_curriculum_id_idx on public.question_bank(curriculum_id);
create index grades_teacher_reviewed_by_idx on public.grades(teacher_reviewed_by);

drop policy "Staff can read active style_templates" on public.style_templates;
create policy "Staff can read active style_templates"
  on public.style_templates for select
  using (is_active and exists (select 1 from public.teachers where teachers.user_id = (select auth.uid())));

drop policy "Staff can read question_bank" on public.question_bank;
create policy "Staff can read question_bank"
  on public.question_bank for select
  using (exists (select 1 from public.teachers where teachers.user_id = (select auth.uid())));

drop policy "Staff can insert question_bank" on public.question_bank;
create policy "Staff can insert question_bank"
  on public.question_bank for insert
  with check (exists (select 1 from public.teachers where teachers.user_id = (select auth.uid())));
