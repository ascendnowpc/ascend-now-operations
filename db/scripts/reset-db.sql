-- =========================================================
-- db/scripts/reset-db.sql
-- =========================================================
-- Hard reset: wipes ALL data except the admin account(s).
--
-- Run this in TWO passes in the Supabase SQL Editor:
--   Pass 1 — the RESET block (everything up to the dashed line)
--   Pass 2 — the RE-SEED block (everything after the dashed line)
--
-- REQUIREMENTS:
--   • Run as a user with full table access (service role /
--     postgres role in the Supabase SQL Editor — NOT the
--     anon key or a logged-in teacher/student session).
--   • The admin row in public.users (role = 'admin') and its
--     matching auth.users entry are the ONLY things preserved.
--
-- WHAT IS DELETED:
--   • All session_logs
--   • All teacher_subjects
--   • All teachers
--   • All students
--   • All subjects, curricula, subject_categories, program_types
--     (these are re-seeded in Pass 2 so the app still works)
--   • All public.users rows where role != 'admin'
--   • All auth.users rows not linked to an admin public.users row
--     (removes those users' login credentials entirely)
-- =========================================================


-- =========================================================
-- PASS 1 — RESET
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- Step 1: Clear FK columns in lookup tables that point at
--         teachers / auth.users before we truncate those tables.
-- ---------------------------------------------------------

UPDATE public.curricula
SET added_by_teacher_id    = NULL,
    acknowledged_by_user_id = NULL,
    acknowledged_at         = NULL;

UPDATE public.subjects
SET added_by_teacher_id    = NULL,
    acknowledged_by_user_id = NULL,
    acknowledged_at         = NULL;

-- ---------------------------------------------------------
-- Step 2: Truncate all transactional + lookup tables in one
--         statement so Postgres can resolve FK constraints
--         across all of them at once.
--         (subjects before subject_categories in the list
--          due to the category_id FK — order matters here.)
-- ---------------------------------------------------------

TRUNCATE TABLE
    public.session_logs,
    public.zoom_invoices,
    public.teacher_subjects,
    public.teachers,
    public.students,
    public.subjects,
    public.curriculum_groups,
    public.subject_categories,
    public.curricula,
    public.program_types
RESTART IDENTITY;

-- ---------------------------------------------------------
-- Step 5: Non-admin user profiles
--         admins table rows are intentionally left alone —
--         they all reference admin users and must stay.
-- ---------------------------------------------------------

DELETE FROM public.users
WHERE role != 'admin';

-- ---------------------------------------------------------
-- Step 6: Remove non-admin auth accounts (login credentials)
--         Any auth.users row not linked to a remaining
--         public.users row is removed here.
-- ---------------------------------------------------------

DELETE FROM auth.users
WHERE id NOT IN (
    SELECT id FROM public.users
);

COMMIT;

-- =========================================================
-- PASS 2 — RE-SEED LOOKUP TABLES
-- =========================================================
-- Without this the app's dropdowns are empty and session
-- logging is completely broken. Run immediately after Pass 1.
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- program_types
-- Insert top-level entries first, then sub-items with parent.
-- ---------------------------------------------------------

INSERT INTO public.program_types (name, type, is_active) VALUES
    ('Academics',                'academic',        true),
    ('Beyond Academics',         'beyond_academic',  true),
    ('ECA/School collaboration', NULL,              true),
    ('Demo Lesson',              'demo_lesson',     true),
    ('Offline Work',             'offline_work',    true),
    ('NO SHOW',                  NULL,              true),
    ('Zoom Invoice',             'zoom_invoice',    false), -- retired: Zoom Invoices now live in their own section, not Type of program
    ('College Counselling',      NULL,              true),
    ('Coaching',                 NULL,              true),
    ('Others',                   NULL,              true);

INSERT INTO public.program_types (name, type, is_active, parent_id) VALUES
    ('Offline work for AN',       NULL, true, (SELECT id FROM public.program_types WHERE type = 'offline_work')),
    ('Offline work for students', NULL, true, (SELECT id FROM public.program_types WHERE type = 'offline_work')),
    ('Offline Work for essays',   NULL, true, (SELECT id FROM public.program_types WHERE type = 'offline_work')),
    ('Online Work for essays',    NULL, true, (SELECT id FROM public.program_types WHERE type = 'offline_work'));

-- ---------------------------------------------------------
-- subject_categories
-- ---------------------------------------------------------

INSERT INTO public.subject_categories (name, type, sort_order) VALUES
    ('Academic',         'academic',        1),
    ('College Support',  'beyond_academic', 2),
    ('Profile Building', 'beyond_academic', 3);

-- ---------------------------------------------------------
-- curricula
-- ---------------------------------------------------------

INSERT INTO public.curricula (name, sort_order) VALUES
    ('IBDP',          1),
    ('IBMYP',         2),
    ('IGCSE',         3),
    ('AS & A Levels', 4), -- renamed from 'A Levels' (see db/schema/27_align_subject_hierarchy_with_reference.sql)
    ('AP',            5),
    ('SAT',           6),
    ('TOEFL',         7),
    ('IELTS',         8),
    ('Common Core',   9),
    ('General',       10),
    ('Other',         11);

-- ---------------------------------------------------------
-- subjects — academic
-- ---------------------------------------------------------
-- IBMYP, IBDP, IGCSE, AS & A Levels, and AP get a full
-- Curriculum -> Group -> Subject hierarchy (curriculum_groups +
-- subjects.curriculum_group_id/board/subject_code/level), matching
-- db/schema/26_curriculum_hierarchy.sql and
-- db/schema/27_align_subject_hierarchy_with_reference.sql exactly
-- (seeded directly in their final, corrected form here — this is a
-- fresh reseed, not an incremental migration, so there's no need to
-- seed-then-correct). The other 6 curricula (SAT, TOEFL, IELTS,
-- Common Core, General, Other) have no pre-seeded subjects — teachers
-- add their own via My Subjects / Subjects Library.

-- =========================================================
-- IBMYP
-- =========================================================

INSERT INTO public.curriculum_groups (curriculum_id, name, sort_order)
SELECT c.id, v.name, v.so
FROM public.curricula c,
(VALUES
    ('Subject Group 1: Language and Literature',    1),
    ('Subject Group 2: Language Acquisition',       2),
    ('Subject Group 3: Individuals and Societies',  3),
    ('Subject Group 4: Sciences',                   4),
    ('Subject Group 5: Mathematics',                5),
    ('Subject Group 6: Arts',                       6),
    ('Subject Group 7: Physical and Health Education', 7),
    ('Subject Group 8: Design',                     8),
    ('Core Requirements',                           9)
) AS v(name, so)
WHERE c.name = 'IBMYP';

INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBMYP' AND cg.name = 'Subject Group 1: Language and Literature') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('English',                                1),
        ('Spanish',                                2),
        ('Mandarin',                               3),
        ('French',                                 4),
        ('Arabic',                                 5),
        ('Bahasa Indonesia',                       6),
        ('Hindi',                                  7),
        ('German',                                 8),
        ('Host-country / Mother-tongue Language',  9)
    ) AS v(name, so);

INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBMYP' AND cg.name = 'Subject Group 2: Language Acquisition') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('English (Additional Language)', 1),
        ('French',                        2),
        ('Spanish',                       3),
        ('Mandarin',                      4),
        ('Arabic',                        5),
        ('German',                        6),
        ('Japanese',                      7)
    ) AS v(name, so);

INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBMYP' AND cg.name = 'Subject Group 3: Individuals and Societies') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Integrated Humanities',  1),
        ('History',                2),
        ('Geography',              3),
        ('Economics',              4),
        ('Business Management',    5)
    ) AS v(name, so);

INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBMYP' AND cg.name = 'Subject Group 4: Sciences') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Integrated Sciences', 1),
        ('Biology',             2),
        ('Chemistry',           3),
        ('Physics',             4)
    ) AS v(name, so);

INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBMYP' AND cg.name = 'Subject Group 5: Mathematics') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Standard Mathematics', 1),
        ('Extended Mathematics', 2)
    ) AS v(name, so);

INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBMYP' AND cg.name = 'Subject Group 6: Arts') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Visual Arts',      1),
        ('Music',            2),
        ('Drama / Theatre',  3),
        ('Dance',            4),
        ('Media Arts / Film',5)
    ) AS v(name, so);

INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBMYP' AND cg.name = 'Subject Group 7: Physical and Health Education') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Physical and Health Education', 1)
    ) AS v(name, so);

INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBMYP' AND cg.name = 'Subject Group 8: Design') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Digital Design',  1),
        ('Product Design',  2)
    ) AS v(name, so);

INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBMYP' AND cg.name = 'Core Requirements') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Personal Project',       1),
        ('Community Project',      2),
        ('Interdisciplinary Units',3),
        ('Service as Action',      4)
    ) AS v(name, so);


-- =========================================================
-- IBDP
-- =========================================================

INSERT INTO public.curriculum_groups (curriculum_id, name, sort_order)
SELECT c.id, v.name, v.so
FROM public.curricula c,
(VALUES
    ('Group 1 — Studies in Language and Literature', 1),
    ('Group 2 — Language Acquisition',               2),
    ('Group 3 — Individuals and Societies',          3),
    ('Group 4 — Sciences',                           4),
    ('Group 5 — Mathematics',                        5),
    ('Group 6 — The Arts',                           6),
    ('Diploma Programme Core',                       7)
) AS v(name, so)
WHERE c.name = 'IBDP';

-- IBDP · Group 1: Studies in Language and Literature
-- Language A: Language and Literature (14 languages × SL/HL) + Language A: Literature (14 languages × SL/HL) + Literature and Performance (SL)
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBDP' AND cg.name = 'Group 1 — Studies in Language and Literature') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('English A: Language and Literature',          'Standard Level',  1),
        ('English A: Language and Literature',          'Higher Level',    2),
        ('French A: Language and Literature',           'Standard Level',  3),
        ('French A: Language and Literature',           'Higher Level',    4),
        ('Spanish A: Language and Literature',          'Standard Level',  5),
        ('Spanish A: Language and Literature',          'Higher Level',    6),
        ('German A: Language and Literature',           'Standard Level',  7),
        ('German A: Language and Literature',           'Higher Level',    8),
        ('Mandarin A: Language and Literature',         'Standard Level',  9),
        ('Mandarin A: Language and Literature',         'Higher Level',   10),
        ('Arabic A: Language and Literature',           'Standard Level', 11),
        ('Arabic A: Language and Literature',           'Higher Level',   12),
        ('Hindi A: Language and Literature',            'Standard Level', 13),
        ('Hindi A: Language and Literature',            'Higher Level',   14),
        ('Bahasa Indonesia A: Language and Literature', 'Standard Level', 15),
        ('Bahasa Indonesia A: Language and Literature', 'Higher Level',   16),
        ('Japanese A: Language and Literature',         'Standard Level', 17),
        ('Japanese A: Language and Literature',         'Higher Level',   18),
        ('Korean A: Language and Literature',           'Standard Level', 19),
        ('Korean A: Language and Literature',           'Higher Level',   20),
        ('Dutch A: Language and Literature',            'Standard Level', 21),
        ('Dutch A: Language and Literature',            'Higher Level',   22),
        ('Italian A: Language and Literature',          'Standard Level', 23),
        ('Italian A: Language and Literature',          'Higher Level',   24),
        ('Portuguese A: Language and Literature',       'Standard Level', 25),
        ('Portuguese A: Language and Literature',       'Higher Level',   26),
        ('Russian A: Language and Literature',          'Standard Level', 27),
        ('Russian A: Language and Literature',          'Higher Level',   28),
        ('English A: Literature',                       'Standard Level', 29),
        ('English A: Literature',                       'Higher Level',   30),
        ('French A: Literature',                        'Standard Level', 31),
        ('French A: Literature',                        'Higher Level',   32),
        ('Spanish A: Literature',                       'Standard Level', 33),
        ('Spanish A: Literature',                       'Higher Level',   34),
        ('German A: Literature',                        'Standard Level', 35),
        ('German A: Literature',                        'Higher Level',   36),
        ('Mandarin A: Literature',                      'Standard Level', 37),
        ('Mandarin A: Literature',                      'Higher Level',   38),
        ('Arabic A: Literature',                        'Standard Level', 39),
        ('Arabic A: Literature',                        'Higher Level',   40),
        ('Hindi A: Literature',                         'Standard Level', 41),
        ('Hindi A: Literature',                         'Higher Level',   42),
        ('Bahasa Indonesia A: Literature',              'Standard Level', 43),
        ('Bahasa Indonesia A: Literature',              'Higher Level',   44),
        ('Japanese A: Literature',                      'Standard Level', 45),
        ('Japanese A: Literature',                      'Higher Level',   46),
        ('Korean A: Literature',                        'Standard Level', 47),
        ('Korean A: Literature',                        'Higher Level',   48),
        ('Dutch A: Literature',                         'Standard Level', 49),
        ('Dutch A: Literature',                         'Higher Level',   50),
        ('Italian A: Literature',                       'Standard Level', 51),
        ('Italian A: Literature',                       'Higher Level',   52),
        ('Portuguese A: Literature',                    'Standard Level', 53),
        ('Portuguese A: Literature',                    'Higher Level',   54),
        ('Russian A: Literature',                       'Standard Level', 55),
        ('Russian A: Literature',                       'Higher Level',   56),
        ('Literature and Performance',                  'Standard Level', 57)
    ) AS v(name, lev, so);

-- IBDP · Group 2: Language Acquisition
-- B languages (12 × SL/HL) + ab initio (7 × SL) + Classical Languages (merged, × SL/HL)
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBDP' AND cg.name = 'Group 2 — Language Acquisition') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('English B',              'Standard Level',  1),
        ('English B',              'Higher Level',    2),
        ('French B',               'Standard Level',  3),
        ('French B',               'Higher Level',    4),
        ('Spanish B',              'Standard Level',  5),
        ('Spanish B',              'Higher Level',    6),
        ('German B',               'Standard Level',  7),
        ('German B',               'Higher Level',    8),
        ('Mandarin B',             'Standard Level',  9),
        ('Mandarin B',             'Higher Level',   10),
        ('Arabic B',               'Standard Level', 11),
        ('Arabic B',               'Higher Level',   12),
        ('Hindi B',                'Standard Level', 13),
        ('Hindi B',                'Higher Level',   14),
        ('Bahasa Indonesia B',     'Standard Level', 15),
        ('Bahasa Indonesia B',     'Higher Level',   16),
        ('Japanese B',             'Standard Level', 17),
        ('Japanese B',             'Higher Level',   18),
        ('Korean B',               'Standard Level', 19),
        ('Korean B',               'Higher Level',   20),
        ('Italian B',              'Standard Level', 21),
        ('Italian B',              'Higher Level',   22),
        ('Russian B',              'Standard Level', 23),
        ('Russian B',              'Higher Level',   24),
        ('French ab initio',       'Standard Level', 25),
        ('Spanish ab initio',      'Standard Level', 26),
        ('German ab initio',       'Standard Level', 27),
        ('Mandarin ab initio',     'Standard Level', 28),
        ('Arabic ab initio',       'Standard Level', 29),
        ('Italian ab initio',      'Standard Level', 30),
        ('Japanese ab initio',     'Standard Level', 31),
        ('Classical Languages (Latin / Classical Greek)', 'Standard Level', 32),
        ('Classical Languages (Latin / Classical Greek)', 'Higher Level',   33)
    ) AS v(name, lev, so);

-- IBDP · Group 3: Individuals and Societies
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBDP' AND cg.name = 'Group 3 — Individuals and Societies') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Business Management',                    'Standard Level',  1),
        ('Business Management',                    'Higher Level',    2),
        ('Economics',                              'Standard Level',  3),
        ('Economics',                              'Higher Level',    4),
        ('Geography',                              'Standard Level',  5),
        ('Geography',                              'Higher Level',    6),
        ('History',                                'Standard Level',  7),
        ('History',                                'Higher Level',    8),
        ('Global Politics',                        'Standard Level',  9),
        ('Global Politics',                        'Higher Level',   10),
        ('Psychology',                             'Standard Level', 11),
        ('Psychology',                             'Higher Level',   12),
        ('Philosophy',                             'Standard Level', 13),
        ('Philosophy',                             'Higher Level',   14),
        ('Social and Cultural Anthropology',       'Standard Level', 15),
        ('Social and Cultural Anthropology',       'Higher Level',   16),
        ('Environmental Systems and Societies',    'Standard Level', 17),
        ('Environmental Systems and Societies',    'Higher Level',   18),
        ('Information Technology in a Global Society', 'Standard Level', 19),
        ('Information Technology in a Global Society', 'Higher Level',   20),
        ('World Religions',                        'Standard Level', 21),
        ('Digital Society',                        'Standard Level', 22),
        ('Digital Society',                        'Higher Level',   23)
    ) AS v(name, lev, so);

-- IBDP · Group 4: Sciences
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBDP' AND cg.name = 'Group 4 — Sciences') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Biology',                                'Standard Level',  1),
        ('Biology',                                'Higher Level',    2),
        ('Chemistry',                              'Standard Level',  3),
        ('Chemistry',                              'Higher Level',    4),
        ('Physics',                                'Standard Level',  5),
        ('Physics',                                'Higher Level',    6),
        ('Computer Science',                       'Standard Level',  7),
        ('Computer Science',                       'Higher Level',    8),
        ('Design Technology',                      'Standard Level',  9),
        ('Design Technology',                      'Higher Level',   10),
        ('Sports, Exercise and Health Science',    'Standard Level', 11),
        ('Sports, Exercise and Health Science',    'Higher Level',   12),
        ('Environmental Systems and Societies',    'Standard Level', 13),
        ('Environmental Systems and Societies',    'Higher Level',   14)
    ) AS v(name, lev, so);

-- IBDP · Group 5: Mathematics
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBDP' AND cg.name = 'Group 5 — Mathematics') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Mathematics: Analysis and Approaches',       'Standard Level', 1),
        ('Mathematics: Analysis and Approaches',       'Higher Level',   2),
        ('Mathematics: Applications and Interpretation','Standard Level', 3),
        ('Mathematics: Applications and Interpretation','Higher Level',   4)
    ) AS v(name, lev, so);

-- IBDP · Group 6: The Arts
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBDP' AND cg.name = 'Group 6 — The Arts') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Visual Arts',            'Standard Level',  1),
        ('Visual Arts',            'Higher Level',    2),
        ('Music',                  'Standard Level',  3),
        ('Music',                  'Higher Level',    4),
        ('Theatre',                'Standard Level',  5),
        ('Theatre',                'Higher Level',    6),
        ('Film',                   'Standard Level',  7),
        ('Film',                   'Higher Level',    8),
        ('Dance',                  'Standard Level',  9),
        ('Dance',                  'Higher Level',   10),
        ('Literature and Performance', 'Standard Level', 11)
    ) AS v(name, lev, so);

-- IBDP · Diploma Programme Core
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IBDP' AND cg.name = 'Diploma Programme Core') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Theory of Knowledge',           1),
        ('Extended Essay',                2),
        ('Creativity, Activity, Service', 3)
    ) AS v(name, so);


-- =========================================================
-- IGCSE
-- =========================================================

INSERT INTO public.curriculum_groups (curriculum_id, name, sort_order)
SELECT c.id, v.name, v.so
FROM public.curricula c,
(VALUES
    ('English & Languages',              1),
    ('Sciences',                         2),
    ('Mathematics',                      3),
    ('Humanities & Social Sciences',     4),
    ('Creative, Technical & Vocational', 5)
) AS v(name, so)
WHERE c.name = 'IGCSE';

-- IGCSE · English & Languages
-- Cambridge (21) + Edexcel (9)
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IGCSE' AND cg.name = 'English & Languages') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('English - First Language',                    'Cambridge',       '0500',  1),
        ('English - First Language (US)',               'Cambridge',       '0524',  2),
        ('English - First Language (9-1)',              'Cambridge',       '0990',  3),
        ('English - Literature in English',             'Cambridge',       '0475',  4),
        ('English - Literature (9-1)',                  'Cambridge',       '0992',  5),
        ('English - Second Language (Count-in Speaking)','Cambridge',      '0510',  6),
        ('English - Second Language (Speaking Endorsed)','Cambridge',      '0511',  7),
        ('English - Second Language (9-1)',             'Cambridge',       '0991',  8),
        ('French - Foreign Language',                   'Cambridge',       '0520',  9),
        ('French (9-1)',                                'Cambridge',       '7156', 10),
        ('Spanish - Foreign Language',                  'Cambridge',       '0530', 11),
        ('German - Foreign Language',                   'Cambridge',       '0525', 12),
        ('Mandarin Chinese - Foreign Language',         'Cambridge',       '0547', 13),
        ('Chinese - First Language',                    'Cambridge',       '0509', 14),
        ('Chinese - Second Language',                   'Cambridge',       '0523', 15),
        ('Arabic - First Language',                     'Cambridge',       '0508', 16),
        ('Arabic - Foreign Language',                   'Cambridge',       '0544', 17),
        ('Hindi as a Second Language',                  'Cambridge',       '0549', 18),
        ('Malay - Foreign Language',                    'Cambridge',       '0546', 19),
        ('Indonesian - Foreign Language',               'Cambridge',       '0545', 20),
        ('Japanese - Foreign Language',                 'Cambridge',       '0519', 21),
        ('English as a Second Language',                'Pearson Edexcel', '4ES1', 22),
        ('English Language A',                          'Pearson Edexcel', '4EA1', 23),
        ('English Language B',                          'Pearson Edexcel', '4EB1', 24),
        ('English Literature',                          'Pearson Edexcel', '4ET1', 25),
        ('French',                                      'Pearson Edexcel', '4FR1', 26),
        ('Spanish',                                     'Pearson Edexcel', '4SP1', 27),
        ('German',                                      'Pearson Edexcel', '4GN1', 28),
        ('Arabic - First Language',                     'Pearson Edexcel', '4AA1', 29),
        ('Mandarin Chinese',                            'Pearson Edexcel', '4CN1', 30)
    ) AS v(name, board, code, so);

-- IGCSE · Sciences
-- Cambridge (9) + Edexcel (5)
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IGCSE' AND cg.name = 'Sciences') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Biology',                         'Cambridge',       '0610',  1),
        ('Biology (9-1)',                   'Cambridge',       '0970',  2),
        ('Chemistry',                       'Cambridge',       '0620',  3),
        ('Chemistry (9-1)',                 'Cambridge',       '0971',  4),
        ('Physics',                         'Cambridge',       '0625',  5),
        ('Physics (9-1)',                   'Cambridge',       '0972',  6),
        ('Combined Science',                'Cambridge',       '0653',  7),
        ('Co-ordinated Sciences (Double)',  'Cambridge',       '0654',  8),
        ('Environmental Management',        'Cambridge',       '0680',  9),
        ('Biology',                         'Pearson Edexcel', '4BI1', 10),
        ('Chemistry',                       'Pearson Edexcel', '4CH1', 11),
        ('Physics',                         'Pearson Edexcel', '4PH1', 12),
        ('Science (Double Award)',          'Pearson Edexcel', '4SD0', 13),
        ('Human Biology',                   'Pearson Edexcel', '4HB1', 14)
    ) AS v(name, board, code, so);

-- IGCSE · Mathematics
-- Cambridge (4) + Edexcel (3)
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IGCSE' AND cg.name = 'Mathematics') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Mathematics',              'Cambridge',       '0580', 1),
        ('Mathematics (9-1)',        'Cambridge',       '0980', 2),
        ('Mathematics - Additional', 'Cambridge',       '0606', 3),
        ('Mathematics - International','Cambridge',     '0607', 4),
        ('Mathematics A',            'Pearson Edexcel', '4MA1', 5),
        ('Mathematics B',            'Pearson Edexcel', '4MB1', 6),
        ('Further Pure Mathematics', 'Pearson Edexcel', '4PM1', 7)
    ) AS v(name, board, code, so);

-- IGCSE · Humanities & Social Sciences
-- Cambridge (8) + Edexcel (5)
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IGCSE' AND cg.name = 'Humanities & Social Sciences') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Geography',          'Cambridge',       '0460',  1),
        ('History',            'Cambridge',       '0470',  2),
        ('Economics',          'Cambridge',       '0455',  3),
        ('Business Studies',   'Cambridge',       '0450',  4),
        ('Accounting',         'Cambridge',       '0452',  5),
        ('Sociology',          'Cambridge',       '0495',  6),
        ('Global Perspectives','Cambridge',       '0457',  7),
        ('Religious Studies',  'Cambridge',       '0490',  8),
        ('Geography',          'Pearson Edexcel', '4GE1',  9),
        ('History',            'Pearson Edexcel', '4HI1', 10),
        ('Economics',          'Pearson Edexcel', '4EC1', 11),
        ('Business',           'Pearson Edexcel', '4BS1', 12),
        ('Accounting',         'Pearson Edexcel', '4AC1', 13)
    ) AS v(name, board, code, so);

-- IGCSE · Creative, Technical & Vocational
-- Cambridge (8) + Edexcel (4)
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'IGCSE' AND cg.name = 'Creative, Technical & Vocational') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Computer Science',          'Cambridge',       '0478',  1),
        ('Information & Communication Technology', 'Cambridge', '0417', 2),
        ('Art & Design',              'Cambridge',       '0400',  3),
        ('Music',                     'Cambridge',       '0410',  4),
        ('Drama',                     'Cambridge',       '0411',  5),
        ('Physical Education',        'Cambridge',       '0413',  6),
        ('Design & Technology',       'Cambridge',       '0445',  7),
        ('Food & Nutrition',          'Cambridge',       '0648',  8),
        ('Computer Science',          'Pearson Edexcel', '4CP0',  9),
        ('ICT',                       'Pearson Edexcel', '4IT1', 10),
        ('Art & Design',              'Pearson Edexcel', '4AD1', 11),
        ('Commerce',                  'Pearson Edexcel', '4CM1', 12)
    ) AS v(name, board, code, so);


-- =========================================================
-- AS & A Levels (Cambridge International AS & A Level + Pearson Edexcel)
-- =========================================================

INSERT INTO public.curriculum_groups (curriculum_id, name, sort_order)
SELECT c.id, v.name, v.so
FROM public.curricula c,
(VALUES
    ('English & Languages',              1),
    ('Mathematics',                      2),
    ('Sciences',                         3),
    ('Humanities & Social Sciences',     4),
    ('Creative, Technical & Vocational', 5)
) AS v(name, so)
WHERE c.name = 'AS & A Levels';

-- AS & A Levels · English & Languages
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AS & A Levels' AND cg.name = 'English & Languages') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('English Language',                     'Cambridge', '9093',    'Advanced Subsidiary Level',  1),
        ('English Language',                     'Cambridge', '9093',    'Advanced Level',              2),
        ('English Literature',                   'Cambridge', '9695',    'Advanced Subsidiary Level',   3),
        ('English Literature',                   'Cambridge', '9695',    'Advanced Level',               4),
        ('English Language and Literature (ELL)','Cambridge', '8695',    'Advanced Subsidiary Level',   5),
        ('English Language and Literature (ELL)','Cambridge', '8695',    'Advanced Level',                6),
        ('English General Paper',                'Cambridge', '8021',    'Advanced Subsidiary Level',   7),
        ('English General Paper',                'Cambridge', '8021',    'Advanced Level',                8),
        ('French',                               'Cambridge', '9716',    'Advanced Subsidiary Level',   9),
        ('French',                               'Cambridge', '9716',    'Advanced Level',              10),
        ('Spanish',                              'Cambridge', '9719',    'Advanced Subsidiary Level',  11),
        ('Spanish',                              'Cambridge', '9719',    'Advanced Level',              12),
        ('German',                               'Cambridge', '9717',    'Advanced Subsidiary Level',  13),
        ('German',                               'Cambridge', '9717',    'Advanced Level',              14),
        ('Chinese (Mandarin)',                   'Cambridge', '9715',    'Advanced Subsidiary Level',  15),
        ('Chinese (Mandarin)',                   'Cambridge', '9715',    'Advanced Level',              16),
        ('Chinese - Language & Literature',      'Cambridge', '9868',    'Advanced Subsidiary Level',  17),
        ('Chinese - Language & Literature',      'Cambridge', '9868',    'Advanced Level',              18),
        ('Arabic',                               'Cambridge', '9680',    'Advanced Subsidiary Level',  19),
        ('Arabic',                               'Cambridge', '9680',    'Advanced Level',              20),
        ('Hindi',                                'Cambridge', '9687',    'Advanced Subsidiary Level',  21),
        ('Hindi',                                'Cambridge', '9687',    'Advanced Level',              22),
        ('Japanese (Language)',                  'Cambridge', '8281',    'Advanced Subsidiary Level',  23),
        ('Japanese (Language)',                  'Cambridge', '8281',    'Advanced Level',              24),
        ('Urdu',                                 'Cambridge', '9676',    'Advanced Subsidiary Level',  25),
        ('Urdu',                                 'Cambridge', '9676',    'Advanced Level',              26),
        ('Tamil',                                'Cambridge', '9689',    'Advanced Subsidiary Level',  27),
        ('Tamil',                                'Cambridge', '9689',    'Advanced Level',              28),
        ('Marathi',                              'Cambridge', '9696',    'Advanced Subsidiary Level',  29),
        ('Marathi',                              'Cambridge', '9696',    'Advanced Level',              30),
        ('Portuguese',                           'Cambridge', '9718',    'Advanced Subsidiary Level',  31),
        ('Portuguese',                           'Cambridge', '9718',    'Advanced Level',              32),
        ('English Language (Pearson)',           'Edexcel',   'XEL/YEL','Advanced Subsidiary Level',  33),
        ('English Language (Pearson)',           'Edexcel',   'XEL/YEL','Advanced Level',              34),
        ('English Literature (Pearson)',         'Edexcel',   'XET/YET','Advanced Subsidiary Level',  35),
        ('English Literature (Pearson)',         'Edexcel',   'XET/YET','Advanced Level',              36),
        ('French',                               'Edexcel',   'XFR/YFR','Advanced Subsidiary Level',  37),
        ('French',                               'Edexcel',   'XFR/YFR','Advanced Level',              38),
        ('Spanish',                              'Edexcel',   'XSP/YSP','Advanced Subsidiary Level',  39),
        ('Spanish',                              'Edexcel',   'XSP/YSP','Advanced Level',              40),
        ('German',                               'Edexcel',   'XGN/YGN','Advanced Subsidiary Level',  41),
        ('German',                               'Edexcel',   'XGN/YGN','Advanced Level',              42)
    ) AS v(name, board, code, lev, so);

-- AS & A Levels · Mathematics
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AS & A Levels' AND cg.name = 'Mathematics') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Mathematics',         'Cambridge', '9709',    'Advanced Subsidiary Level',  1),
        ('Mathematics',         'Cambridge', '9709',    'Advanced Level',             2),
        ('Further Mathematics', 'Cambridge', '9231',    'Advanced Subsidiary Level',  3),
        ('Further Mathematics', 'Cambridge', '9231',    'Advanced Level',             4),
        ('Mathematics',         'Edexcel',   'XMA/YMA', 'Advanced Subsidiary Level',  5),
        ('Mathematics',         'Edexcel',   'XMA/YMA', 'Advanced Level',             6),
        ('Further Mathematics', 'Edexcel',   'XFM/YFM', 'Advanced Subsidiary Level',  7),
        ('Further Mathematics', 'Edexcel',   'XFM/YFM', 'Advanced Level',             8),
        ('Pure Mathematics',    'Edexcel',   'XPM/YPM', 'Advanced Subsidiary Level',  9),
        ('Pure Mathematics',    'Edexcel',   'XPM/YPM', 'Advanced Level',            10)
    ) AS v(name, board, code, lev, so);

-- AS & A Levels · Sciences
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AS & A Levels' AND cg.name = 'Sciences') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Biology',                  'Cambridge', '9700',    'Advanced Subsidiary Level',  1),
        ('Biology',                  'Cambridge', '9700',    'Advanced Level',             2),
        ('Chemistry',                'Cambridge', '9701',    'Advanced Subsidiary Level',  3),
        ('Chemistry',                'Cambridge', '9701',    'Advanced Level',             4),
        ('Physics',                  'Cambridge', '9702',    'Advanced Subsidiary Level',  5),
        ('Physics',                  'Cambridge', '9702',    'Advanced Level',             6),
        ('Computer Science',         'Cambridge', '9618',    'Advanced Subsidiary Level',  7),
        ('Computer Science',         'Cambridge', '9618',    'Advanced Level',             8),
        ('Marine Science',           'Cambridge', '9693',    'Advanced Subsidiary Level',  9),
        ('Marine Science',           'Cambridge', '9693',    'Advanced Level',            10),
        ('Environmental Management', 'Cambridge', '8291',    'Advanced Subsidiary Level', 11),
        ('Environmental Management', 'Cambridge', '8291',    'Advanced Level',            12),
        ('Design and Technology',    'Cambridge', '9705',    'Advanced Subsidiary Level', 13),
        ('Design and Technology',    'Cambridge', '9705',    'Advanced Level',            14),
        ('Food Studies',             'Cambridge', '9336',    'Advanced Subsidiary Level', 15),
        ('Food Studies',             'Cambridge', '9336',    'Advanced Level',            16),
        ('Biology',                  'Edexcel',   'XBI/YBI', 'Advanced Subsidiary Level', 17),
        ('Biology',                  'Edexcel',   'XBI/YBI', 'Advanced Level',            18),
        ('Chemistry',                'Edexcel',   'XCH/YCH', 'Advanced Subsidiary Level', 19),
        ('Chemistry',                'Edexcel',   'XCH/YCH', 'Advanced Level',            20),
        ('Physics',                  'Edexcel',   'XPH/YPH', 'Advanced Subsidiary Level', 21),
        ('Physics',                  'Edexcel',   'XPH/YPH', 'Advanced Level',            22)
    ) AS v(name, board, code, lev, so);

-- AS & A Levels · Humanities & Social Sciences
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AS & A Levels' AND cg.name = 'Humanities & Social Sciences') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('History',                          'Cambridge', '9489',    'Advanced Subsidiary Level',  1),
        ('History',                          'Cambridge', '9489',    'Advanced Level',             2),
        ('Geography',                        'Cambridge', '9696',    'Advanced Subsidiary Level',  3),
        ('Geography',                        'Cambridge', '9696',    'Advanced Level',             4),
        ('Economics',                        'Cambridge', '9708',    'Advanced Subsidiary Level',  5),
        ('Economics',                        'Cambridge', '9708',    'Advanced Level',             6),
        ('Business',                         'Cambridge', '9609',    'Advanced Subsidiary Level',  7),
        ('Business',                         'Cambridge', '9609',    'Advanced Level',             8),
        ('Accounting',                       'Cambridge', '9706',    'Advanced Subsidiary Level',  9),
        ('Accounting',                       'Cambridge', '9706',    'Advanced Level',            10),
        ('Psychology',                       'Cambridge', '9990',    'Advanced Subsidiary Level', 11),
        ('Psychology',                       'Cambridge', '9990',    'Advanced Level',            12),
        ('Sociology',                        'Cambridge', '9699',    'Advanced Subsidiary Level', 13),
        ('Sociology',                        'Cambridge', '9699',    'Advanced Level',            14),
        ('Law',                              'Cambridge', '9084',    'Advanced Subsidiary Level', 15),
        ('Law',                              'Cambridge', '9084',    'Advanced Level',            16),
        ('Global Perspectives & Research',   'Cambridge', '9239',    'Advanced Subsidiary Level', 17),
        ('Global Perspectives & Research',   'Cambridge', '9239',    'Advanced Level',            18),
        ('Thinking Skills',                  'Cambridge', '9694',    'Advanced Subsidiary Level', 19),
        ('Thinking Skills',                  'Cambridge', '9694',    'Advanced Level',            20),
        ('Classical Studies',                'Cambridge', '9274',    'Advanced Subsidiary Level', 21),
        ('Classical Studies',                'Cambridge', '9274',    'Advanced Level',            22),
        ('History',                          'Edexcel',   'XHI/YHI', 'Advanced Subsidiary Level', 23),
        ('History',                          'Edexcel',   'XHI/YHI', 'Advanced Level',            24),
        ('Geography',                        'Edexcel',   'XGE/YGE', 'Advanced Subsidiary Level', 25),
        ('Geography',                        'Edexcel',   'XGE/YGE', 'Advanced Level',            26),
        ('Economics',                        'Edexcel',   'XEC/YEC', 'Advanced Subsidiary Level', 27),
        ('Economics',                        'Edexcel',   'XEC/YEC', 'Advanced Level',            28),
        ('Business',                         'Edexcel',   'XBS/YBS', 'Advanced Subsidiary Level', 29),
        ('Business',                         'Edexcel',   'XBS/YBS', 'Advanced Level',            30),
        ('Accounting',                       'Edexcel',   'XAC/YAC', 'Advanced Subsidiary Level', 31),
        ('Accounting',                       'Edexcel',   'XAC/YAC', 'Advanced Level',            32),
        ('Psychology',                       'Edexcel',   'XPS/YPS', 'Advanced Subsidiary Level', 33),
        ('Psychology',                       'Edexcel',   'XPS/YPS', 'Advanced Level',            34),
        ('Law',                              'Edexcel',   'XLA/YLA', 'Advanced Subsidiary Level', 35),
        ('Law',                              'Edexcel',   'XLA/YLA', 'Advanced Level',            36)
    ) AS v(name, board, code, lev, so);

-- AS & A Levels · Creative, Technical & Vocational
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, board, subject_code, level, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.board, v.code, v.lev, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AS & A Levels' AND cg.name = 'Creative, Technical & Vocational') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('Information Technology', 'Cambridge', '9626',    'Advanced Subsidiary Level',  1),
        ('Information Technology', 'Cambridge', '9626',    'Advanced Level',             2),
        ('Art & Design',           'Cambridge', '9479',    'Advanced Subsidiary Level',  3),
        ('Art & Design',           'Cambridge', '9479',    'Advanced Level',             4),
        ('Music',                  'Cambridge', '9483',    'Advanced Subsidiary Level',  5),
        ('Music',                  'Cambridge', '9483',    'Advanced Level',             6),
        ('Drama',                  'Cambridge', '9482',    'Advanced Subsidiary Level',  7),
        ('Drama',                  'Cambridge', '9482',    'Advanced Level',             8),
        ('Media Studies',          'Cambridge', '9607',    'Advanced Subsidiary Level',  9),
        ('Media Studies',          'Cambridge', '9607',    'Advanced Level',            10),
        ('Digital Media & Design', 'Cambridge', '9481',    'Advanced Subsidiary Level', 11),
        ('Digital Media & Design', 'Cambridge', '9481',    'Advanced Level',            12),
        ('Physical Education',     'Cambridge', '9396',    'Advanced Subsidiary Level', 13),
        ('Physical Education',     'Cambridge', '9396',    'Advanced Level',            14),
        ('Travel & Tourism',       'Cambridge', '9395',    'Advanced Subsidiary Level', 15),
        ('Travel & Tourism',       'Cambridge', '9395',    'Advanced Level',            16),
        ('Information Technology', 'Edexcel',   'XIT/YIT', 'Advanced Subsidiary Level', 17),
        ('Information Technology', 'Edexcel',   'XIT/YIT', 'Advanced Level',            18),
        ('Art & Design',           'Edexcel',   'XAD/YAD', 'Advanced Subsidiary Level', 19),
        ('Art & Design',           'Edexcel',   'XAD/YAD', 'Advanced Level',            20)
    ) AS v(name, board, code, lev, so);


-- =========================================================
-- AP (Advanced Placement)
-- =========================================================

INSERT INTO public.curriculum_groups (curriculum_id, name, sort_order)
SELECT c.id, v.name, v.so
FROM public.curricula c,
(VALUES
    ('Mathematics and Computer Science', 1),
    ('Sciences',                         2),
    ('English',                          3),
    ('History and Social Sciences',      4),
    ('World Languages and Cultures',     5),
    ('Arts',                             6),
    ('AP Capstone',                      7)
) AS v(name, so)
WHERE c.name = 'AP';

-- AP · Mathematics and Computer Science
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AP' AND cg.name = 'Mathematics and Computer Science') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('AP Calculus AB',                1),
        ('AP Calculus BC',                2),
        ('AP Statistics',                 3),
        ('AP Computer Science A',         4),
        ('AP Computer Science Principles',5),
        ('AP Precalculus',                6)
    ) AS v(name, so);

-- AP · Sciences
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AP' AND cg.name = 'Sciences') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('AP Biology',                              1),
        ('AP Chemistry',                            2),
        ('AP Physics 1: Algebra-Based',             3),
        ('AP Physics 2: Algebra-Based',             4),
        ('AP Physics C: Mechanics',                 5),
        ('AP Physics C: Electricity and Magnetism', 6),
        ('AP Environmental Science',                7)
    ) AS v(name, so);

-- AP · English
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AP' AND cg.name = 'English') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('AP English Language and Composition',  1),
        ('AP English Literature and Composition',2)
    ) AS v(name, so);

-- AP · History and Social Sciences
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AP' AND cg.name = 'History and Social Sciences') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('AP Microeconomics',                           1),
        ('AP Macroeconomics',                           2),
        ('AP Psychology',                               3),
        ('AP Human Geography',                          4),
        ('AP United States Government and Politics',    5),
        ('AP Comparative Government and Politics',      6),
        ('AP United States History',                    7),
        ('AP European History',                         8),
        ('AP World History: Modern',                    9)
    ) AS v(name, so);

-- AP · World Languages and Cultures
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AP' AND cg.name = 'World Languages and Cultures') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('AP Chinese Language and Culture',  1),
        ('AP French Language and Culture',   2),
        ('AP German Language and Culture',   3),
        ('AP Italian Language and Culture',  4),
        ('AP Japanese Language and Culture', 5),
        ('AP Latin',                         6),
        ('AP Spanish Language and Culture',  7),
        ('AP Spanish Literature and Culture',8)
    ) AS v(name, so);

-- AP · Arts
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AP' AND cg.name = 'Arts') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('AP Art and Design: 2-D', 1),
        ('AP Art and Design: 3-D', 2),
        ('AP Art and Design: Drawing', 3),
        ('AP Music Theory',       4),
        ('AP Art History',        5)
    ) AS v(name, so);

-- AP · AP Capstone
INSERT INTO public.subjects (name, category, category_id, curriculum_group_id, sort_order)
SELECT v.name, 'academic', ac.id, g.id, v.so FROM
    (SELECT cg.id FROM public.curriculum_groups cg JOIN public.curricula c ON c.id = cg.curriculum_id WHERE c.name = 'AP' AND cg.name = 'AP Capstone') g,
    (SELECT id FROM public.subject_categories WHERE type = 'academic' LIMIT 1) ac,
    (VALUES
        ('AP Seminar', 1),
        ('AP Research',2)
    ) AS v(name, so);

-- subjects — college support
INSERT INTO public.subjects (name, category, sort_order, is_active, category_id) VALUES
    ('College Counselling', 'college_support', 10, true, (SELECT id FROM public.subject_categories WHERE name = 'College Support')),
    ('College Essays',      'college_support', 20, true, (SELECT id FROM public.subject_categories WHERE name = 'College Support'));

-- subjects — profile building
INSERT INTO public.subjects (name, category, sort_order, is_active, category_id) VALUES
    ('Creative Writing',           'profile_building',  10, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Research Writing',           'profile_building',  20, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Blog Writing',               'profile_building',  30, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Journalistic Writing',       'profile_building',  40, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Writing Development',        'profile_building',  50, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Public Speaking',            'profile_building',  60, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Passion Project',            'profile_building',  70, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Podcast',                    'profile_building',  80, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Job Application Mentorship', 'profile_building',  90, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Executive Function Coaching','profile_building', 100, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Content Development',        'profile_building', 110, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building')),
    ('Work for Ascend Now',        'profile_building', 120, true, (SELECT id FROM public.subject_categories WHERE name = 'Profile Building'));

COMMIT;

-- =========================================================
-- VERIFY (optional — run after both passes)
-- =========================================================
-- Uncomment to confirm the reset looks correct:
--
-- SELECT 'session_logs'      AS tbl, COUNT(*) FROM public.session_logs
-- UNION ALL
-- SELECT 'teacher_subjects',         COUNT(*) FROM public.teacher_subjects
-- UNION ALL
-- SELECT 'teachers',                 COUNT(*) FROM public.teachers
-- UNION ALL
-- SELECT 'students',                 COUNT(*) FROM public.students
-- UNION ALL
-- SELECT 'program_types',            COUNT(*) FROM public.program_types
-- UNION ALL
-- SELECT 'curricula',                COUNT(*) FROM public.curricula
-- UNION ALL
-- SELECT 'subject_categories',       COUNT(*) FROM public.subject_categories
-- UNION ALL
-- SELECT 'subjects',                 COUNT(*) FROM public.subjects
-- UNION ALL
-- SELECT 'public.users (total)',      COUNT(*) FROM public.users
-- UNION ALL
-- SELECT 'public.users (admin only)', COUNT(*) FROM public.users WHERE role = 'admin'
-- UNION ALL
-- SELECT 'admins',                    COUNT(*) FROM public.admins;
