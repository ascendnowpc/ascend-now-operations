-- Homework Generator — Phase 2: seed the style-template library.
-- One row per exam-format the teacher can pick in the paper-composition builder,
-- covering every active curriculum (IBDP, IBMYP, IGCSE, AS & A Levels, AP, Standard
-- Tests) plus the generic question types. `prompt_fragment` is the actual instruction
-- text handed to the Gemini prompt builder in Phase 4 (format, command words,
-- mark-scheme shape, expected length). `question_type` is the controlled value the
-- generation and grading phases key off — `mcq`/`fill_blank` are auto-gradable by exact
-- match; `short_answer`/`structured`/`extended_response`/`essay`/`criterion` are
-- LLM-graded against a mark scheme.
--
-- Idempotent: `ON CONFLICT (code)` re-applies the latest wording without duplicating
-- rows, so this can be re-run and future wording tweaks can ship as their own migration.

insert into public.style_templates (code, name, board, question_type, prompt_fragment) values

('IBDP_SECTION_A', 'IBDP — Paper Section A (structured short answer)', 'IBDP', 'structured',
 'Write IB Diploma Programme Paper 1/2 Section A style structured questions. Each question opens with a precise IB command term ("State", "Outline", "Describe", "Explain", "Calculate", "Distinguish", "Suggest") whose depth matches the marks available. Use structured multi-part items where useful (a), (b), (c) with escalating command terms and mark weights, typically 1-6 marks per part. For every question provide a points-based mark scheme: one bullet per creditworthy point (marks awarded per point, e.g. "[1] for identifying X; [1] for linking X to Y"), matching IB assessment conventions. Anchor every question to the supplied source content. Keep wording exam-formal and unambiguous.'),

('IBDP_SECTION_B', 'IBDP — Paper Section B (extended response)', 'IBDP', 'extended_response',
 'Write IB Diploma Programme Section B extended-response questions worth 8-15 marks each, opening with a higher-order command term ("Discuss", "Evaluate", "To what extent", "Analyse", "Compare and contrast"). Each question demands a structured argued response, not recall. Provide a mark scheme as a list of specific creditworthy points grouped into the assessment strands the response is marked against (knowledge/understanding, application/analysis, synthesis/evaluation), each with its mark allocation, plus a brief note on what distinguishes a top-band answer. State the expected response length (several developed paragraphs). Ground the question in the supplied source content.'),

('IB_MYP', 'IB MYP — criterion-referenced', 'IBMYP', 'criterion',
 'Write IB Middle Years Programme criterion-referenced questions. Tag each question to the MYP assessment criteria it targets (Criterion A Knowing & understanding, B Investigating/Inquiring, C Communicating, D Thinking critically / applying) and phrase it so a student produces evidence against those criteria. Use age-appropriate command terms and scaffold multi-part items from lower to higher order. Provide a mark scheme mapped to the MYP 0-8 criterion band descriptors — describe what a response in each achievement band (e.g. 1-2, 3-4, 5-6, 7-8) looks like — rather than a flat points total. Base every question on the supplied source content.'),

('IGCSE_CORE', 'IGCSE — Core tier', 'IGCSE', 'structured',
 'Write Cambridge IGCSE Core-tier structured questions aimed at grades C-G. Use accessible command words ("State", "Give", "Name", "Identify", "Describe", "Complete"), short scaffolded parts (typically 1-3 marks each), and clear mark allocations shown in brackets after each part. Keep language and cognitive demand at Core tier — direct recall and straightforward application, no extended synthesis. Provide a points-based mark scheme with one creditworthy point per mark and acceptable alternative answers listed where relevant. Anchor every question to the supplied source content.'),

('IGCSE_EXTENDED', 'IGCSE — Extended tier', 'IGCSE', 'structured',
 'Write Cambridge IGCSE Extended-tier structured questions aimed at grades A*-E. Use the full range of command words including higher-demand ones ("Explain", "Suggest", "Calculate", "Compare", "Analyse"), multi-part items (a), (b), (c) with mark weights typically 1-6 per part shown in brackets, and at least one part requiring extended reasoning or multi-step working. Provide a points-based mark scheme: one bullet per creditworthy point with its mark, error-carried-forward notes for calculations where relevant, and acceptable alternatives. Ground every question in the supplied source content.'),

('AS_A_LEVEL', 'AS / A-Level — structured', 'AS & A Levels', 'structured',
 'Write AS / A-Level structured questions at the appropriate depth (AS = foundational application; A2 = synthesis and evaluation across topics). Use rigorous command words ("Explain", "Analyse", "Evaluate", "Justify", "Derive", "Assess"), multi-part items escalating in demand, and mark allocations shown in brackets (parts commonly 2-10 marks, with at least one extended part). Provide a levels-based or points-based mark scheme as fits the question: for extended parts describe the mark bands and what separates them; for shorter parts list creditworthy points with marks. State expected answer length for extended parts. Base every question on the supplied source content.'),

('AP_MCQ', 'AP — multiple choice', 'AP', 'mcq',
 'Write College Board AP-style multiple-choice questions with exactly four options (A-D), one unambiguously correct answer and three plausible distractors that reflect common misconceptions. Questions should test understanding and application in the AP style — many stem from a short scenario, data set, or stimulus rather than bare recall. For each question return the four options, the letter of the correct answer, and a one-line rationale explaining why it is correct and why each distractor is wrong. Keep exactly one correct option. Base every question on the supplied source content.'),

('AP_FRQ', 'AP — free response', 'AP', 'extended_response',
 'Write College Board AP-style free-response questions (FRQs): a scenario or stimulus followed by lettered parts (a), (b), (c) each targeting a specific skill, worth defined points that sum to the question total. Use AP task verbs ("Identify", "Describe", "Explain", "Calculate", "Justify"). Provide an AP-style scoring guideline: for each part, the exact point(s) available and the specific response element that earns each point ("1 point for stating X"; "1 point for correct reasoning linking X and Y"). State expected length per part. Ground the question in the supplied source content.'),

('MCQ', 'Multiple choice (generic)', null, 'mcq',
 'Write clear multiple-choice questions with four options (A-D), exactly one correct answer and three plausible distractors targeting likely misconceptions. Avoid "all/none of the above" and trivially eliminable options. For each question return the options, the correct option letter, and a short explanation of the correct answer. Exactly one option must be correct. Base every question on the supplied source content.'),

('FILL_IN_BLANK', 'Fill in the blank (generic)', null, 'fill_blank',
 'Write fill-in-the-blank questions: a sentence or short passage with one clearly marked gap ("____") testing a single key term, definition, or value. Each gap must have an unambiguous intended answer. For each question return the sentence with the gap, the exact expected answer, and a short list of acceptable alternative spellings/synonyms so grading can match fairly. Keep gaps focused on the most important vocabulary or facts in the supplied source content.'),

('SHORT_ANSWER', 'Short answer (generic)', null, 'short_answer',
 'Write short-answer questions requiring one to three sentences (typically 1-4 marks). Each targets a specific concept, definition, cause/effect, or worked value from the supplied source content. Provide a points-based mark scheme: one bullet per creditworthy point with its mark and any acceptable equivalent phrasings, so partial credit can be awarded. Keep questions precise enough that a correct answer is recognisable, avoiding open-ended essay prompts.'),

('SUBJECTIVE', 'Subjective / extended response (generic)', null, 'essay',
 'Write open-ended extended-response questions requiring a structured, argued answer of one or more paragraphs. Each question should invite analysis, evaluation, or reasoned discussion of the supplied source content, not recall. Critically, provide the mark scheme as a list of SPECIFIC, individually gradeable points (each with its own mark), not a single model answer — the downstream LLM grader awards partial credit point by point, so a vague "the answer should discuss X" is not acceptable. Include a note on what distinguishes a strong response and the expected length.')

on conflict (code) do update set
  name = excluded.name,
  board = excluded.board,
  question_type = excluded.question_type,
  prompt_fragment = excluded.prompt_fragment,
  is_active = true;
