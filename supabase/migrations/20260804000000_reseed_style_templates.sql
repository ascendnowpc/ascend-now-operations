-- Re-seed the homework generator's "Question type" library.
--
-- `style_templates` was EMPTY in the live database, so the Question type
-- dropdown in the Homework Generator's Paper composition section offered
-- nothing but its "Select a question type..." placeholder — no paper could be
-- built at all. The builder reads the table through useStyleTemplates()
-- (is_active + is_selectable) and shows the generic rows (board is null).
--
-- Why it was empty: the seeding migrations (20260716000000 base seed and
-- 20260726010000, which renamed the generic four and added True/False) are
-- both recorded as applied in supabase_migrations.schema_migrations, yet
-- style_templates_id_seq sat at last_value = 1, is_called = false — no row was
-- ever inserted here. This project's early migration history was baselined
-- (marked applied) rather than actually run. The 2026-08-03 purge is NOT the
-- cause: it deliberately leaves the catalogue tables, style_templates
-- included, untouched.
--
-- Idempotent (ON CONFLICT (code) DO UPDATE), so it is a no-op wherever the
-- rows already exist. No schema change.
--
-- SCOPE — this restores the five GENERIC templates only, which is the entire
-- set the builder can reach today. The board families (IBDP/IGCSE/AP/AS-A
-- Level/MYP heads from 20260716000000) and their subject- and group-level
-- variants (20260721000000 / 20260722000000) are deliberately NOT re-seeded:
-- TeacherHomeworkPage filters the picker to `board is null`, so no paper can
-- select a family head, and generate-homework-paper's resolver only considers
-- variants sharing the picked template's `section_key` — a generic head's
-- section_key is its own code, which no variant shares. They are therefore
-- unreachable, and seeding ~130 unreachable rows would just be noise. If board
-- families are ever put back in the builder, re-run the data statements of
-- those three migrations (all ON CONFLICT-idempotent) as a new migration then.
-- Recorded in db/docs/HOMEWORK_GENERATOR_ARCHITECTURE.md.
--
-- Text below is verbatim from the original migrations: prompt_fragment as
-- seeded in 20260716000000 / 20260726010000, names as renamed by
-- 20260726010000, and section_key = code (the value 20260721000000's backfill
-- would have given these rows).

insert into public.style_templates (code, name, board, question_type, section_key, prompt_fragment)
select v.code, v.name, v.board, v.question_type, v.code, v.prompt_fragment
from (values

('MCQ', 'Multiple Choice (MCQ)', null, 'mcq',
 'Write clear multiple-choice questions with four options (A-D), exactly one correct answer and three plausible distractors targeting likely misconceptions. Avoid "all/none of the above" and trivially eliminable options. For each question return the options, the correct option letter, and a short explanation of the correct answer. Exactly one option must be correct. Base every question on the supplied source content.'),

('FILL_IN_BLANK', 'Fill in the Blanks', null, 'fill_blank',
 'Write fill-in-the-blank questions: a sentence or short passage with one clearly marked gap ("____") testing a single key term, definition, or value. Each gap must have an unambiguous intended answer. For each question return the sentence with the gap, the exact expected answer, and a short list of acceptable alternative spellings/synonyms so grading can match fairly. Keep gaps focused on the most important vocabulary or facts in the supplied source content.'),

('SHORT_ANSWER', 'Short Answer', null, 'short_answer',
 'Write short-answer questions requiring one to three sentences (typically 1-4 marks). Each targets a specific concept, definition, cause/effect, or worked value from the supplied source content. Provide a points-based mark scheme: one bullet per creditworthy point with its mark and any acceptable equivalent phrasings, so partial credit can be awarded. Keep questions precise enough that a correct answer is recognisable, avoiding open-ended essay prompts.'),

('SUBJECTIVE', 'Long Answer', null, 'essay',
 'Write open-ended extended-response questions requiring a structured, argued answer of one or more paragraphs. Each question should invite analysis, evaluation, or reasoned discussion of the supplied source content, not recall. Critically, provide the mark scheme as a list of SPECIFIC, individually gradeable points (each with its own mark), not a single model answer — the downstream LLM grader awards partial credit point by point, so a vague "the answer should discuss X" is not acceptable. Include a note on what distinguishes a strong response and the expected length.'),

('TRUE_FALSE', 'True / False', null, 'true_false',
 'Write true/false questions: a single, clear, factual statement about the supplied source content. Each statement must be unambiguously verifiable as either true or false -- avoid opinions, trick wording, or statements that hinge on a technicality. Return exactly two options in this exact order: ["True", "False"], and set correct_option to 0 if the statement is true, or 1 if the statement is false. Base every statement on the supplied source content.')

) as v(code, name, board, question_type, prompt_fragment)
on conflict (code) do update set
  name = excluded.name,
  board = excluded.board,
  question_type = excluded.question_type,
  prompt_fragment = excluded.prompt_fragment,
  is_active = true;
