-- Homework Generator — group-level style templates covering every curriculum's
-- subject groups, so ALL subjects resolve to a subject-area-appropriate template.
--
-- 20260721000000 added the hierarchy + resolver and a few IBDP English/Maths
-- SUBJECT-level overrides. This seeds the layer beneath them: one template per
-- (curriculum group × the section-families that curriculum uses). Exam FORMAT
-- differs by subject AREA (the group) far more than by individual subject — an
-- IBDP Group 4 Science Section A is a data-response/structured item for every
-- science; an IBDP Group 3 Individuals & Societies Section A is source-analysis
-- for every humanity — so a per-group template makes each of the 453 subjects
-- resolve to the right area template via the resolver's curriculum_group_id
-- layer, without needing 453 rows. Subject-level overrides (e.g. English/Maths)
-- still win on top where a subject genuinely diverges.
--
-- All rows are is_selectable=false: the teacher still picks the generic family
-- head ("IBDP — Section A"); these are resolution-only. Idempotent via
-- ON CONFLICT (code). Groups are matched by (curriculum, group name) so ids are
-- not hardcoded. AP Capstone (Seminar/Research) is intentionally excluded — it
-- is performance-task assessed, not MCQ/FRQ, so it falls back to the generic AP
-- head rather than getting a misleading MCQ/FRQ template.

with seed(code, section_key, curriculum_name, group_name, question_type, prompt_fragment) as (
  values
  -- ============================ IBDP — Section A (structured) ============================
  ('IBDP_SECTION_A__LANGLIT','IBDP_SECTION_A','IBDP','Group 1 — Studies in Language and Literature','structured',
   'IBDP Studies in Language and Literature Section A guided textual-analysis short questions on a supplied literary or non-literary text. Use command terms Analyse, Comment on, Explore; each item targets HOW meaning and effect are created (diction, tone, imagery, structure, stylistic choices) for a stated audience and purpose. Points-based mark scheme: one bullet per creditworthy analytical point tied to textual evidence, marks per point; assertion without evidence earns nothing.'),
  ('IBDP_SECTION_A__LANGACQ','IBDP_SECTION_A','IBDP','Group 2 — Language Acquisition','structured',
   'IBDP Language Acquisition Section A text-handling short questions on a supplied text in the target language. Test comprehension, inference, vocabulary in context and grammatical understanding via short items (true/false with justification, gap-fill, matching, short answer). Points-based mark scheme: one mark per correct comprehension or language point with acceptable alternative wordings; credit communication even with minor slips.'),
  ('IBDP_SECTION_A__INDSOC','IBDP_SECTION_A','IBDP','Group 3 — Individuals and Societies','structured',
   'IBDP Individuals and Societies Section A structured short-answer questions using command terms Define, Identify, Outline, Explain, Distinguish, escalating across parts (a)(b)(c) with mark weights 1-6. Require precise subject terminology, evidence and real case-study examples. Points-based mark scheme: one bullet per creditworthy point covering knowledge and application, marks per point, acceptable alternatives.'),
  ('IBDP_SECTION_A__SCIENCES','IBDP_SECTION_A','IBDP','Group 4 — Sciences','structured',
   'IBDP Sciences Section A structured and data-response short questions using command terms State, Define, Calculate, Determine, Deduce, Explain, with data, graphs or a short experimental scenario where useful; marks 1-6 per part in brackets. Points-based mark scheme separating method from answer, error-carried-forward for multi-step calculations, and acceptable units and significant-figure tolerance.'),
  ('IBDP_SECTION_A__MATH','IBDP_SECTION_A','IBDP','Group 5 — Mathematics','structured',
   'IBDP Mathematics Section A short-response questions worth 4-7 marks: self-contained calculation and derivation problems using Find, Solve, Show that, Determine across the syllabus. Mark scheme by method (M) and answer (A) marks, follow-through where a later part uses an earlier result, and exact or three-significant-figure answer expectations.'),
  ('IBDP_SECTION_A__ARTS','IBDP_SECTION_A','IBDP','Group 6 — The Arts','structured',
   'IBDP The Arts Section A short structured questions on the analysis and appraisal of specific artworks or performances, using command terms Describe, Identify, Analyse, Compare with reference to techniques, materials, context and artistic intention. Points-based mark scheme: one bullet per creditworthy analytical or contextual point supported by reference to the work, marks per point.'),
  ('IBDP_SECTION_A__CORE','IBDP_SECTION_A','IBDP','Diploma Programme Core','structured',
   'IBDP Diploma Programme Core (Theory of Knowledge) Section A short knowledge questions, each framed around a knowledge claim or question and requiring a brief argument with a real-life example and at least one counter-perspective, using Explain, Analyse, To what extent. Points-based mark scheme rewarding a clear claim, its justification, a relevant example and awareness of a different perspective, marks per point.'),

  -- ============================ IBDP — Section B (extended) ============================
  ('IBDP_SECTION_B__LANGLIT','IBDP_SECTION_B','IBDP','Group 1 — Studies in Language and Literature','extended_response',
   'IBDP Studies in Language and Literature Section B extended essay questions (8-15 marks) opening with Discuss, Evaluate, To what extent, Analyse how. Demand a sustained argued response on how meaning and effect are constructed across the studied text(s), not recall. Mark scheme as specific creditworthy points grouped into knowledge/understanding, analysis and evaluation strands with mark allocations, plus what marks a top-band answer; state expected length (several developed paragraphs).'),
  ('IBDP_SECTION_B__LANGACQ','IBDP_SECTION_B','IBDP','Group 2 — Language Acquisition','extended_response',
   'IBDP Language Acquisition Section B extended productive-writing task in the target language (8-15 marks): a purposeful text type (article, blog, letter, speech) on a supplied theme. Mark scheme by assessment strands language (range and accuracy), message (task achievement and development) and format/register, each with mark bands describing what separates them; state expected length.'),
  ('IBDP_SECTION_B__INDSOC','IBDP_SECTION_B','IBDP','Group 3 — Individuals and Societies','extended_response',
   'IBDP Individuals and Societies Section B extended essay (8-15 marks) using Discuss, Evaluate, To what extent, Examine. Require a balanced, evidenced argument with concepts, case-study examples and a reasoned judgement. Mark scheme as creditworthy points grouped into knowledge, application, analysis and evaluation strands with allocations, plus a note on the top-band discriminator.'),
  ('IBDP_SECTION_B__SCIENCES','IBDP_SECTION_B','IBDP','Group 4 — Sciences','extended_response',
   'IBDP Sciences Section B extended-response questions (8-15 marks): analyse or interpret data, evaluate or outline an experimental method, and give extended scientific explanation. Mark scheme as specific creditworthy points across understanding, application and evaluation with allocations, error-carried-forward where relevant, and acceptable units and tolerance.'),
  ('IBDP_SECTION_B__MATH','IBDP_SECTION_B','IBDP','Group 5 — Mathematics','extended_response',
   'IBDP Mathematics Section B extended multi-step problems and proofs (8-15 marks) using Find, Hence, Show that, Prove across connected parts. Mark scheme separating method (M), answer (A) and reasoning (R) marks, follow-through between parts, and exact-form answer expectations; each part builds on the last.'),
  ('IBDP_SECTION_B__ARTS','IBDP_SECTION_B','IBDP','Group 6 — The Arts','extended_response',
   'IBDP The Arts Section B extended comparative and contextual essay (8-15 marks) on studied works using Analyse, Compare and contrast, Evaluate. Require sustained analysis linking technique, intention and context. Mark scheme as creditworthy analytical and evaluative points referencing specific works, grouped by strand with allocations, plus the top-band discriminator.'),
  ('IBDP_SECTION_B__CORE','IBDP_SECTION_B','IBDP','Diploma Programme Core','extended_response',
   'IBDP Diploma Programme Core (Theory of Knowledge) Section B extended response (8-15 marks): a developed argument on a knowledge question drawing on at least two areas of knowledge, with counterclaims and real-life examples. Mark scheme as creditworthy points rewarding a clear thesis, contrasting perspectives, well-chosen examples and evaluation of knowledge, with mark bands.'),

  -- ============================ IBMYP — criterion ============================
  ('IB_MYP__LANGLIT','IB_MYP','IBMYP','Subject Group 1: Language and Literature','criterion',
   'IB MYP Language and Literature criterion-referenced questions tagged to Criterion A Analysing, B Organizing, C Producing text and D Using language. Phrase tasks so the student analyses and produces text as evidence against those criteria; scaffold lower to higher order. Mark scheme mapped to the 0-8 band descriptors (describe the 1-2, 3-4, 5-6, 7-8 bands) rather than a flat total.'),
  ('IB_MYP__LANGACQ','IB_MYP','IBMYP','Subject Group 2: Language Acquisition','criterion',
   'IB MYP Language Acquisition criterion-referenced questions tagged to Criterion A Comprehending spoken and visual text, B Comprehending written and visual text, C Communicating, D Using language, set in the target language at the appropriate phase. Mark scheme mapped to the 0-8 criterion band descriptors, not a flat points total.'),
  ('IB_MYP__INDSOC','IB_MYP','IBMYP','Subject Group 3: Individuals and Societies','criterion',
   'IB MYP Individuals and Societies criterion-referenced questions tagged to Criterion A Knowing and understanding, B Investigating, C Communicating, D Thinking critically, using sources and inquiry. Mark scheme mapped to the 0-8 band descriptors describing each achievement band.'),
  ('IB_MYP__SCIENCES','IB_MYP','IBMYP','Subject Group 4: Sciences','criterion',
   'IB MYP Sciences criterion-referenced questions tagged to Criterion A Knowing and understanding, B Inquiring and designing, C Processing and evaluating, D Reflecting on the impacts of science, using data and investigation contexts. Mark scheme mapped to the 0-8 band descriptors.'),
  ('IB_MYP__MATH','IB_MYP','IBMYP','Subject Group 5: Mathematics','criterion',
   'IB MYP Mathematics criterion-referenced questions tagged to Criterion A Knowing and understanding, B Investigating patterns, C Communicating, D Applying mathematics in real-life contexts. Scaffold from procedure to reasoning; mark scheme mapped to the 0-8 band descriptors, not a flat total.'),
  ('IB_MYP__ARTS','IB_MYP','IBMYP','Subject Group 6: Arts','criterion',
   'IB MYP Arts criterion-referenced questions tagged to Criterion A Knowing and understanding, B Developing skills, C Thinking creatively, D Responding, referencing artworks or performances. Mark scheme mapped to the 0-8 band descriptors.'),
  ('IB_MYP__PHE','IB_MYP','IBMYP','Subject Group 7: Physical and Health Education','criterion',
   'IB MYP Physical and Health Education criterion-referenced questions tagged to Criterion A Knowing and understanding, B Planning for performance, C Applying and performing, D Reflecting and improving performance. Mark scheme mapped to the 0-8 band descriptors.'),
  ('IB_MYP__DESIGN','IB_MYP','IBMYP','Subject Group 8: Design','criterion',
   'IB MYP Design criterion-referenced questions tagged to Criterion A Inquiring and analysing, B Developing ideas, C Creating the solution, D Evaluating, framed around a design problem. Mark scheme mapped to the 0-8 band descriptors.'),
  ('IB_MYP__CORE','IB_MYP','IBMYP','Core Requirements','criterion',
   'IB MYP Core (interdisciplinary and personal-project style) criterion-referenced questions framed as inquiry that integrates concepts across subjects and requires reflection. Tag to the relevant interdisciplinary criteria and map the mark scheme to the 0-8 band descriptors rather than a flat total.'),

  -- ============================ IGCSE — Core tier ============================
  ('IGCSE_CORE__ENGLANG','IGCSE_CORE','IGCSE','English & Languages','structured',
   'Cambridge IGCSE Core-tier English and Languages structured questions (grades C-G) on a supplied text: reading comprehension, vocabulary and short directed-writing items using State, Give, Identify, Explain briefly. Short scaffolded parts 1-3 marks in brackets. Points-based mark scheme, one point per mark, with acceptable alternative answers.'),
  ('IGCSE_CORE__SCIENCES','IGCSE_CORE','IGCSE','Sciences','structured',
   'Cambridge IGCSE Core-tier Sciences structured questions (grades C-G) using accessible command words State, Name, Describe, Complete, with short recall and straightforward application parts 1-3 marks in brackets. Points-based mark scheme, one creditworthy point per mark, acceptable alternatives and units where relevant.'),
  ('IGCSE_CORE__MATH','IGCSE_CORE','IGCSE','Mathematics','structured',
   'Cambridge IGCSE Core-tier Mathematics questions (grades C-G): short single-step and two-step problems using Work out, Calculate, Find, marks in brackets. Mark scheme showing method and answer marks with follow-through, accepting equivalent correct forms.'),
  ('IGCSE_CORE__HUMANITIES','IGCSE_CORE','IGCSE','Humanities & Social Sciences','structured',
   'Cambridge IGCSE Core-tier Humanities and Social Sciences structured questions (grades C-G) using Describe, Give, Identify with short source-based or recall parts 1-3 marks. Points-based mark scheme, one point per mark, acceptable examples and alternatives.'),
  ('IGCSE_CORE__CREATIVE','IGCSE_CORE','IGCSE','Creative, Technical & Vocational','structured',
   'Cambridge IGCSE Core-tier Creative, Technical and Vocational structured questions (grades C-G) using State, Identify, Describe on practical and applied content, parts 1-3 marks. Points-based mark scheme, one creditworthy point per mark, acceptable alternatives.'),

  -- ============================ IGCSE — Extended tier ============================
  ('IGCSE_EXTENDED__ENGLANG','IGCSE_EXTENDED','IGCSE','English & Languages','structured',
   'Cambridge IGCSE Extended-tier English and Languages structured questions (grades A*-E) on a supplied text: analytical reading and extended directed-writing using Explain, Analyse, Compare, with multi-part items and at least one part needing developed reasoning; marks in brackets. Points-based mark scheme rewarding analysis with textual evidence.'),
  ('IGCSE_EXTENDED__SCIENCES','IGCSE_EXTENDED','IGCSE','Sciences','structured',
   'Cambridge IGCSE Extended-tier Sciences structured questions (grades A*-E) using Explain, Suggest, Calculate, Compare, multi-part (a)(b)(c) with weights 1-6 and at least one multi-step or extended-reasoning part. Points-based mark scheme separating method and answer, error-carried-forward, acceptable units and alternatives.'),
  ('IGCSE_EXTENDED__MATH','IGCSE_EXTENDED','IGCSE','Mathematics','structured',
   'Cambridge IGCSE Extended-tier Mathematics questions (grades A*-E): multi-step problems using Calculate, Solve, Show that, Determine with weights in brackets and at least one part requiring extended working. Mark scheme with method and answer marks, follow-through, and exact or rounded answer expectations.'),
  ('IGCSE_EXTENDED__HUMANITIES','IGCSE_EXTENDED','IGCSE','Humanities & Social Sciences','structured',
   'Cambridge IGCSE Extended-tier Humanities and Social Sciences structured questions (grades A*-E) using Explain, Analyse, Evaluate on sources and case studies, multi-part with an extended-reasoning part. Points-based mark scheme covering knowledge, application and analysis, acceptable examples.'),
  ('IGCSE_EXTENDED__CREATIVE','IGCSE_EXTENDED','IGCSE','Creative, Technical & Vocational','structured',
   'Cambridge IGCSE Extended-tier Creative, Technical and Vocational structured questions (grades A*-E) using Explain, Analyse, Justify on applied and practical content, multi-part with a developed-reasoning part. Points-based mark scheme rewarding applied understanding with acceptable alternatives.'),

  -- ============================ AS & A Levels — structured ============================
  ('AS_A_LEVEL__ENGLANG','AS_A_LEVEL','AS & A Levels','English & Languages','structured',
   'AS/A-Level English and Languages structured and analytical questions: close analysis of texts and directed response using Analyse, Discuss, Evaluate, Compare. AS targets foundational analysis, A2 sustained evaluation across texts; marks in brackets with at least one extended part. Mark scheme by levels for extended parts (describe the bands) and points for shorter parts.'),
  ('AS_A_LEVEL__MATH','AS_A_LEVEL','AS & A Levels','Mathematics','structured',
   'AS/A-Level Mathematics structured questions using Find, Show that, Prove, Hence, Determine, multi-part and escalating (AS foundational; A2 synthesis across topics), marks 2-10 in brackets. Mark scheme separating method (M), answer (A) and reasoning (R) marks with follow-through and exact-form expectations.'),
  ('AS_A_LEVEL__SCIENCES','AS_A_LEVEL','AS & A Levels','Sciences','structured',
   'AS/A-Level Sciences structured and data-response questions using Explain, Calculate, Analyse, Evaluate, Derive, with at least one extended part; AS foundational application, A2 synthesis and evaluation. Mark scheme by points for shorter parts and mark bands for extended parts, with error-carried-forward and acceptable units.'),
  ('AS_A_LEVEL__HUMANITIES','AS_A_LEVEL','AS & A Levels','Humanities & Social Sciences','structured',
   'AS/A-Level Humanities and Social Sciences structured and essay-style questions using Explain, Analyse, Assess, Evaluate, Justify with evidence and theory; AS foundational, A2 synthesis and judgement. Mark scheme by levels/bands for extended parts (describe discriminators) and creditworthy points for shorter parts.'),
  ('AS_A_LEVEL__CREATIVE','AS_A_LEVEL','AS & A Levels','Creative, Technical & Vocational','structured',
   'AS/A-Level Creative, Technical and Vocational structured questions using Explain, Analyse, Evaluate, Justify on applied content and case studies, with at least one extended part. Mark scheme combining points-based and levels-based marking as fits the part, with acceptable applied examples.'),

  -- ============================ AP — multiple choice ============================
  ('AP_MCQ__MATHCS','AP_MCQ','AP','Mathematics and Computer Science','mcq',
   'College Board AP Mathematics and Computer Science multiple-choice questions with exactly four options A-D, one correct answer and three plausible distractors reflecting common errors; many stem from a calculation, code snippet or scenario. Return the four options, the correct letter, and a one-line rationale explaining the answer and why each distractor is wrong.'),
  ('AP_MCQ__SCIENCES','AP_MCQ','AP','Sciences','mcq',
   'College Board AP Sciences multiple-choice questions with four options A-D, one correct and three misconception-based distractors, many stemming from data, an experiment or a scenario rather than bare recall. Return the options, the correct letter, and a one-line rationale for the answer and distractors.'),
  ('AP_MCQ__ENGLISH','AP_MCQ','AP','English','mcq',
   'College Board AP English multiple-choice questions on a supplied passage: four options A-D testing reading comprehension, rhetoric and meaning, one correct answer and three plausible distractors. Return the options, the correct letter, and a one-line rationale grounded in the passage.'),
  ('AP_MCQ__HISTSOC','AP_MCQ','AP','History and Social Sciences','mcq',
   'College Board AP History and Social Sciences multiple-choice questions in stimulus-based sets (source, chart or excerpt), four options A-D, one correct and three plausible distractors. Return the options, the correct letter, and a one-line rationale tied to the stimulus.'),
  ('AP_MCQ__WORLDLANG','AP_MCQ','AP','World Languages and Cultures','mcq',
   'College Board AP World Languages and Cultures multiple-choice questions on a supplied text or scenario in the target language, testing comprehension and interpretation; four options A-D, one correct and three plausible distractors. Return the options, the correct letter, and a brief rationale.'),
  ('AP_MCQ__ARTS','AP_MCQ','AP','Arts','mcq',
   'College Board AP Arts multiple-choice questions, many referencing an image or work, testing analysis, technique and context; four options A-D, one correct and three plausible distractors. Return the options, the correct letter, and a one-line rationale referencing the work.'),

  -- ============================ AP — free response ============================
  ('AP_FRQ__MATHCS','AP_FRQ','AP','Mathematics and Computer Science','extended_response',
   'College Board AP Mathematics and Computer Science free-response questions: a scenario or problem with lettered parts (a)(b)(c), each worth defined points summing to the total, using Calculate, Justify, Explain, Determine. Provide an AP scoring guideline naming the exact response element that earns each point; state expected working per part.'),
  ('AP_FRQ__SCIENCES','AP_FRQ','AP','Sciences','extended_response',
   'College Board AP Sciences free-response questions: an experimental or data scenario with lettered parts using Identify, Describe, Explain, Calculate, Justify, points summing to the total. Provide an AP scoring guideline stating what earns each point, with acceptable reasoning and units.'),
  ('AP_FRQ__ENGLISH','AP_FRQ','AP','English','extended_response',
   'College Board AP English free-response questions (analysis, argument or synthesis) on supplied text(s): a prompt requiring a thesis-driven essay. Provide an AP-style rubric with points for thesis, evidence and commentary, and sophistication, describing what earns each; state expected length.'),
  ('AP_FRQ__HISTSOC','AP_FRQ','AP','History and Social Sciences','extended_response',
   'College Board AP History and Social Sciences free-response questions (short-answer and document/evidence-based) using Identify, Explain, Analyse, Evaluate. Provide an AP scoring guideline naming the exact element that earns each point (thesis, evidence, reasoning) with acceptable examples.'),
  ('AP_FRQ__WORLDLANG','AP_FRQ','AP','World Languages and Cultures','extended_response',
   'College Board AP World Languages and Cultures free-response tasks in the target language (written and presentational), with a scenario prompt. Provide an AP-style rubric across task completion, language use and cultural appropriateness describing each band; state expected length.'),
  ('AP_FRQ__ARTS','AP_FRQ','AP','Arts','extended_response',
   'College Board AP Arts free-response questions requiring analysis of works and justification of artistic choices, with lettered parts and defined points. Provide an AP scoring guideline naming what earns each point with reference to the work; state expected length per part.')
)
insert into public.style_templates
  (code, name, board, question_type, section_key, curriculum_id, curriculum_group_id, subject_id, is_selectable, prompt_fragment)
select
  s.code,
  c.name || ' · ' || g.name || ' — ' || case s.section_key
    when 'IBDP_SECTION_A' then 'Section A'
    when 'IBDP_SECTION_B' then 'Section B'
    when 'IGCSE_CORE' then 'Core'
    when 'IGCSE_EXTENDED' then 'Extended'
    when 'AS_A_LEVEL' then 'AS/A-Level'
    when 'AP_MCQ' then 'MCQ'
    when 'AP_FRQ' then 'FRQ'
    when 'IB_MYP' then 'MYP criterion'
    else s.section_key
  end as name,
  c.name as board,
  s.question_type,
  s.section_key,
  c.id as curriculum_id,
  g.id as curriculum_group_id,
  null::smallint as subject_id,
  false as is_selectable,
  s.prompt_fragment
from seed s
join public.curricula c on c.name = s.curriculum_name
join public.curriculum_groups g
  on g.curriculum_id = c.id and g.name = s.group_name and g.is_active
on conflict (code) do update set
  name = excluded.name,
  board = excluded.board,
  question_type = excluded.question_type,
  section_key = excluded.section_key,
  curriculum_id = excluded.curriculum_id,
  curriculum_group_id = excluded.curriculum_group_id,
  subject_id = excluded.subject_id,
  is_selectable = excluded.is_selectable,
  prompt_fragment = excluded.prompt_fragment,
  is_active = true;
