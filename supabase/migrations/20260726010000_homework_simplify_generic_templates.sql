-- Homework Generator — simplify the teacher-facing builder to generic
-- templates only (MCQ, Fill in the Blanks, True/False, Short Answer, Long
-- Answer) + difficulty. The curriculum/subject-hierarchy templates (IBDP,
-- IGCSE, AP, ...) and the resolver that picks the most-specific variant are
-- deliberately left untouched — the frontend builder (TeacherHomeworkPage)
-- simply stops offering them, but existing papers built from them (and the
-- resolver code, and AcademicSubjectPicker.tsx) still work exactly as
-- before. See db/docs/HOMEWORK_GENERATOR_ARCHITECTURE.md.
--
-- 1) Rename the 4 existing generic templates' display names to match the
--    simplified vocabulary the builder now uses. Plain UPDATEs (not the
--    INSERT ... ON CONFLICT pattern the original seed used) since these rows
--    already exist and every other column is unchanged.
update public.style_templates set name = 'Multiple Choice (MCQ)' where code = 'MCQ';
update public.style_templates set name = 'Fill in the Blanks' where code = 'FILL_IN_BLANK';
update public.style_templates set name = 'Short Answer' where code = 'SHORT_ANSWER';
update public.style_templates set name = 'Long Answer' where code = 'SUBJECTIVE';

-- 2) Add a 5th generic template: True/False. New question_type value
-- ('true_false') — question_type has no CHECK constraint (plain `text not
-- null`), so no ALTER needed. Data shape mirrors 'mcq' exactly (options +
-- correct_option, exactly 2 options) so generation/grading/rendering code
-- treats it as an mcq variant rather than a new independent shape.
insert into public.style_templates (code, name, board, question_type, section_key, prompt_fragment)
values (
  'TRUE_FALSE',
  'True / False',
  null,
  'true_false',
  'TRUE_FALSE',
  'Write true/false questions: a single, clear, factual statement about the supplied source content. Each statement must be unambiguously verifiable as either true or false -- avoid opinions, trick wording, or statements that hinge on a technicality. Return exactly two options in this exact order: ["True", "False"], and set correct_option to 0 if the statement is true, or 1 if the statement is false. Base every statement on the supplied source content.'
)
on conflict (code) do update set
  name = excluded.name,
  board = excluded.board,
  question_type = excluded.question_type,
  prompt_fragment = excluded.prompt_fragment,
  is_active = true;
