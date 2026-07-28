-- Homework Generator — hang style_templates off the real subject hierarchy.
--
-- Until now the style-template library was flat: one row per exam-format keyed
-- only by `code` + `board` (e.g. a single `IBDP_SECTION_A` used identically for
-- IBDP Maths, English and Physics). But "Section A" genuinely differs by
-- subject and level — an IBDP English SL guided textual analysis is nothing
-- like an IBDP Maths SL structured calculation. This migration lets a template
-- target any point in the EXISTING hierarchy (curriculum -> group -> subject,
-- with level carried inside the subject row since SL/HL are separate subjects)
-- via real foreign keys — no re-typed names that can drift from the live data.
--
-- Resolution (implemented in the generate-homework-paper edge function) walks
-- that hierarchy most-specific-first within a `section_key` family:
--     subject_id           -> "IBDP · English A SL · Section A"   (exact, incl. level)
--     curriculum_group_id  -> "IBDP · Sciences · Section A"
--     curriculum_id        -> "IBDP · Section A"                  (the rows seeded pre-2026-07-21)
--     (all null)           -> generic question-type fallback (MCQ, Short answer, …)
--
-- The existing 12 rows stay valid and become the fallback layer — you add
-- specific rows only where the format really diverges. Subject-specific
-- overrides are `is_selectable = false`: they never appear in the teacher's
-- style dropdown (the teacher still picks the generic family), they only get
-- picked up automatically during generation when the paper's subject matches.

alter table public.style_templates
  add column if not exists section_key text,
  add column if not exists curriculum_id smallint references public.curricula(id) on delete set null,
  add column if not exists curriculum_group_id smallint references public.curriculum_groups(id) on delete set null,
  add column if not exists subject_id smallint references public.subjects(id) on delete set null,
  add column if not exists is_selectable boolean not null default true;

-- Backfill the existing library:
--  * section_key = the row's own code (each is the "head" of its own family).
--  * curriculum_id resolved from the free-text `board` where it names a real
--    curriculum; generic rows (board null) stay curriculum-agnostic.
update public.style_templates t
set section_key = coalesce(section_key, code),
    curriculum_id = coalesce(
      curriculum_id,
      (select c.id from public.curricula c where c.name = t.board)
    )
where section_key is null or (curriculum_id is null and board is not null);

alter table public.style_templates
  alter column section_key set not null;

-- Deterministic resolution: at most one template per specificity slot within a
-- family, so the resolver never has to break a same-score tie ambiguously.
create unique index if not exists style_templates_family_subject_uidx
  on public.style_templates (section_key, subject_id)
  where subject_id is not null;

create unique index if not exists style_templates_family_group_uidx
  on public.style_templates (section_key, curriculum_group_id)
  where subject_id is null and curriculum_group_id is not null;

create unique index if not exists style_templates_family_curriculum_uidx
  on public.style_templates (section_key, curriculum_id)
  where subject_id is null and curriculum_group_id is null and curriculum_id is not null;

create unique index if not exists style_templates_family_generic_uidx
  on public.style_templates (section_key)
  where subject_id is null and curriculum_group_id is null and curriculum_id is null;

-- Fast family lookup during resolution.
create index if not exists style_templates_section_key_idx
  on public.style_templates (section_key);

-- ---------------------------------------------------------------------------
-- Seed a few illustrative SUBJECT-SPECIFIC Section A overrides so the resolver
-- can be seen working end-to-end. These target IBDP English A (Lang & Lit) and
-- IBDP Mathematics (Analysis & Approaches), SL and HL — the exact "English SL
-- IBDP" case. subject_id is resolved by a stable subquery on the live subject
-- (name + level + curriculum) rather than a hardcoded id. They are NOT
-- selectable (is_selectable=false) — the teacher picks "IBDP — Section A" and
-- generation auto-upgrades to the matching subject variant.
-- Idempotent via ON CONFLICT (code).
insert into public.style_templates
  (code, name, board, question_type, section_key, curriculum_id, subject_id, is_selectable, prompt_fragment)
values
  ('IBDP_SECTION_A__ENGLISH_LANGLIT_SL',
   'IBDP · English A: Lang & Lit SL — Section A (guided analysis)', 'IBDP', 'structured',
   'IBDP_SECTION_A', (select id from public.curricula where name = 'IBDP'),
   (select id from public.subjects where curriculum_group_id in
      (select id from public.curriculum_groups where curriculum_id = (select id from public.curricula where name='IBDP'))
      and name = 'English A: Language and Literature' and level = 'Standard Level' and is_active limit 1),
   false,
   'Write IB Diploma Programme English A: Language and Literature (SL) Paper 1 style guided textual-analysis questions. Anchor every question to the supplied text/extract. Each item asks the student to analyse HOW meaning is created — language, style, structure, tone, imagery, register — and its effect on the intended audience and purpose, using a guiding question of the form "Analyse/Examine how the writer uses X to Y". Keep SL demand: close analysis of ONE non-literary text/extract, no cross-text comparison. For every question provide a points-based mark scheme (one bullet per creditworthy analytical point, marks per point, e.g. "[1] identifies device; [1] explains its effect on the reader") and note that unsupported assertion earns nothing without textual evidence. Wording exam-formal.'),

  ('IBDP_SECTION_A__ENGLISH_LANGLIT_HL',
   'IBDP · English A: Lang & Lit HL — Section A (guided analysis)', 'IBDP', 'structured',
   'IBDP_SECTION_A', (select id from public.curricula where name = 'IBDP'),
   (select id from public.subjects where curriculum_group_id in
      (select id from public.curriculum_groups where curriculum_id = (select id from public.curricula where name='IBDP'))
      and name = 'English A: Language and Literature' and level = 'Higher Level' and is_active limit 1),
   false,
   'Write IB Diploma Programme English A: Language and Literature (HL) Paper 1 style guided textual-analysis questions. Anchor every question to the supplied text/extract(s). HL demands greater sophistication than SL: deeper analysis of authorial choices, attention to how form and structure shape meaning, and — where two texts are supplied — comparison and contrast of technique and effect. Each item uses a guiding question ("Analyse/Compare how the writer(s) construct X to achieve Y") and rewards a sustained, well-evidenced argument, not feature-spotting. Provide a points-based mark scheme (one bullet per creditworthy analytical point with its marks) plus a brief note on what distinguishes a top-band HL response (conceptual insight + precise textual support). Wording exam-formal.'),

  ('IBDP_SECTION_A__MATH_AA_SL',
   'IBDP · Mathematics A&A SL — Section A (short response)', 'IBDP', 'structured',
   'IBDP_SECTION_A', (select id from public.curricula where name = 'IBDP'),
   (select id from public.subjects where curriculum_group_id in
      (select id from public.curriculum_groups where curriculum_id = (select id from public.curricula where name='IBDP'))
      and name = 'Mathematics: Analysis and Approaches' and level = 'Standard Level' and is_active limit 1),
   false,
   'Write IB Diploma Programme Mathematics: Analysis and Approaches (SL) Paper Section A short-response questions worth 4-7 marks each. Each is a self-contained calculation/derivation problem requiring worked method, not recall — use command terms "Find", "Solve", "Show that", "Calculate", "Determine". Draw on SL A&A topics (algebra, functions, trigonometry, differential/integral calculus of standard functions, sequences, basic probability). Award marks by method: provide a mark scheme with method (M) and answer (A) marks separated (e.g. "[M1] correct differentiation; [A1] correct value"), include follow-through/error-carried-forward notes where a later part depends on an earlier answer, and state exact/3-s.f. answer expectations. Keep to SL depth — no HL-only topics.'),

  ('IBDP_SECTION_A__MATH_AA_HL',
   'IBDP · Mathematics A&A HL — Section A (short response)', 'IBDP', 'structured',
   'IBDP_SECTION_A', (select id from public.curricula where name = 'IBDP'),
   (select id from public.subjects where curriculum_group_id in
      (select id from public.curriculum_groups where curriculum_id = (select id from public.curricula where name='IBDP'))
      and name = 'Mathematics: Analysis and Approaches' and level = 'Higher Level' and is_active limit 1),
   false,
   'Write IB Diploma Programme Mathematics: Analysis and Approaches (HL) Paper Section A short-response questions worth 5-8 marks each. Each is a self-contained multi-step problem requiring rigorous worked method and, where appropriate, proof — use command terms "Find", "Prove", "Show that", "Hence", "Determine". Draw on the full HL A&A syllabus including HL-only material (proof by induction, complex numbers, vectors, harder calculus — integration by parts/substitution, differential equations, Maclaurin series). Award marks by method: provide a mark scheme separating method (M), answer (A) and reasoning (R) marks (e.g. "[M1] sets up integral; [M1] integrates by parts; [A1] correct result"), with follow-through notes and exact-form answer expectations. Pitch at HL rigour — multi-concept, no trivial single-step items.')

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
