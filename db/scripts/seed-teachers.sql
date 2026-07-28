-- =========================================================
-- db/scripts/seed-teachers.sql
-- =========================================================
-- Seeds 22 teachers (6 performance coaches, 16 regular) with
-- varied countries, academic + beyond-academic subjects.
--
-- Run in the Supabase SQL Editor (postgres / service role).
--
-- PREREQUISITES:
--   • The reset-db.sql Pass 2 (re-seed) has already run so that
--     subjects and curricula exist and have predictable IDs.
--   • pgcrypto extension is enabled (default on Supabase).
-- =========================================================

DO $$
DECLARE
  -- Auth / public user UUIDs (one per teacher)
  u01 uuid := gen_random_uuid();   -- Sarah Chen           (PC)
  u02 uuid := gen_random_uuid();   -- James Wilson
  u03 uuid := gen_random_uuid();   -- Priya Sharma
  u04 uuid := gen_random_uuid();   -- Ahmed Hassan
  u05 uuid := gen_random_uuid();   -- Emma Thompson        (PC)
  u06 uuid := gen_random_uuid();   -- Carlos Mendez
  u07 uuid := gen_random_uuid();   -- Yuki Tanaka
  u08 uuid := gen_random_uuid();   -- Fatima Al-Zahra
  u09 uuid := gen_random_uuid();   -- Marcus Johnson       (PC)
  u10 uuid := gen_random_uuid();   -- Anna Kowalski
  u11 uuid := gen_random_uuid();   -- Raj Patel
  u12 uuid := gen_random_uuid();   -- Sophie Dubois
  u13 uuid := gen_random_uuid();   -- Ibrahim Yilmaz       (PC)
  u14 uuid := gen_random_uuid();   -- Mei Lin
  u15 uuid := gen_random_uuid();   -- Daniel Park
  u16 uuid := gen_random_uuid();   -- Amara Diallo
  u17 uuid := gen_random_uuid();   -- Thomas Weber
  u18 uuid := gen_random_uuid();   -- Isabella Romano
  u19 uuid := gen_random_uuid();   -- Kevin O'Brien
  u20 uuid := gen_random_uuid();   -- Natasha Ivanova      (PC)
  u21 uuid := gen_random_uuid();   -- Alex Kim
  u22 uuid := gen_random_uuid();   -- Zara Ahmed           (PC)

BEGIN

-- ---------------------------------------------------------
-- Step 1: Auth users
-- The create_user_profile trigger fires on each INSERT and
-- creates the matching public.users row using raw_user_meta_data.
-- role = 'performance_coach' for PCs, 'teacher' for the rest.
-- ---------------------------------------------------------

INSERT INTO auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user
) VALUES
  -- 01 Sarah Chen (PC)
  (u01, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sarah.chen@ascendnow.com', crypt('sarah@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"sarah.chen","full_name":"Sarah Chen","role":"performance_coach"}'::jsonb,
   now(), now(), false),

  -- 02 James Wilson
  (u02, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'james.wilson@ascendnow.com', crypt('james@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"james.wilson","full_name":"James Wilson","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 03 Priya Sharma
  (u03, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'priya.sharma@ascendnow.com', crypt('priya@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"priya.sharma","full_name":"Priya Sharma","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 04 Ahmed Hassan
  (u04, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ahmed.hassan@ascendnow.com', crypt('ahmed@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"ahmed.hassan","full_name":"Ahmed Hassan","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 05 Emma Thompson (PC)
  (u05, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'emma.thompson@ascendnow.com', crypt('emma@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"emma.thompson","full_name":"Emma Thompson","role":"performance_coach"}'::jsonb,
   now(), now(), false),

  -- 06 Carlos Mendez
  (u06, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'carlos.mendez@ascendnow.com', crypt('carlos@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"carlos.mendez","full_name":"Carlos Mendez","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 07 Yuki Tanaka
  (u07, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'yuki.tanaka@ascendnow.com', crypt('yuki@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"yuki.tanaka","full_name":"Yuki Tanaka","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 08 Fatima Al-Zahra
  (u08, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fatima.alzahra@ascendnow.com', crypt('fatima@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"fatima.alzahra","full_name":"Fatima Al-Zahra","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 09 Marcus Johnson (PC)
  (u09, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'marcus.johnson@ascendnow.com', crypt('marcus@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"marcus.johnson","full_name":"Marcus Johnson","role":"performance_coach"}'::jsonb,
   now(), now(), false),

  -- 10 Anna Kowalski
  (u10, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'anna.kowalski@ascendnow.com', crypt('anna@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"anna.kowalski","full_name":"Anna Kowalski","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 11 Raj Patel
  (u11, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'raj.patel@ascendnow.com', crypt('raj@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"raj.patel","full_name":"Raj Patel","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 12 Sophie Dubois
  (u12, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sophie.dubois@ascendnow.com', crypt('sophie@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"sophie.dubois","full_name":"Sophie Dubois","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 13 Ibrahim Yilmaz (PC)
  (u13, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ibrahim.yilmaz@ascendnow.com', crypt('ibrahim@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"ibrahim.yilmaz","full_name":"Ibrahim Yilmaz","role":"performance_coach"}'::jsonb,
   now(), now(), false),

  -- 14 Mei Lin
  (u14, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'mei.lin@ascendnow.com', crypt('mei@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"mei.lin","full_name":"Mei Lin","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 15 Daniel Park
  (u15, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'daniel.park@ascendnow.com', crypt('daniel@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"daniel.park","full_name":"Daniel Park","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 16 Amara Diallo
  (u16, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'amara.diallo@ascendnow.com', crypt('amara@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"amara.diallo","full_name":"Amara Diallo","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 17 Thomas Weber
  (u17, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'thomas.weber@ascendnow.com', crypt('thomas@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"thomas.weber","full_name":"Thomas Weber","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 18 Isabella Romano
  (u18, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'isabella.romano@ascendnow.com', crypt('isabella@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"isabella.romano","full_name":"Isabella Romano","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 19 Kevin O'Brien
  (u19, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'kevin.obrien@ascendnow.com', crypt('kevin@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"kevin.obrien","full_name":"Kevin O''Brien","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 20 Natasha Ivanova (PC)
  (u20, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'natasha.ivanova@ascendnow.com', crypt('natasha@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"natasha.ivanova","full_name":"Natasha Ivanova","role":"performance_coach"}'::jsonb,
   now(), now(), false),

  -- 21 Alex Kim
  (u21, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alex.kim@ascendnow.com', crypt('alex@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"alex.kim","full_name":"Alex Kim","role":"teacher"}'::jsonb,
   now(), now(), false),

  -- 22 Zara Ahmed (PC)
  (u22, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'zara.ahmed@ascendnow.com', crypt('zara@ascendnow', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"username":"zara.ahmed","full_name":"Zara Ahmed","role":"performance_coach"}'::jsonb,
   now(), now(), false);


-- ---------------------------------------------------------
-- Step 2: Teacher profiles
-- The trigger has already created public.users rows above,
-- so the user_id FK is satisfied.
-- ---------------------------------------------------------

INSERT INTO public.teachers (user_id, first_name, last_name, email, country, phone_number, is_performance_coach) VALUES
  (u01, 'Sarah',    'Chen',      'sarah.chen@ascendnow.com',     'Singapore',          '+65 91234567',     true),
  (u02, 'James',    'Wilson',    'james.wilson@ascendnow.com',   'United Kingdom',     '+44 7911123456',   false),
  (u03, 'Priya',    'Sharma',    'priya.sharma@ascendnow.com',   'India',              '+91 9876543210',   false),
  (u04, 'Ahmed',    'Hassan',    'ahmed.hassan@ascendnow.com',   'Egypt',              '+20 1012345678',   false),
  (u05, 'Emma',     'Thompson',  'emma.thompson@ascendnow.com',  'Australia',          '+61 412345678',    true),
  (u06, 'Carlos',   'Mendez',    'carlos.mendez@ascendnow.com',  'Mexico',             '+52 5512345678',   false),
  (u07, 'Yuki',     'Tanaka',    'yuki.tanaka@ascendnow.com',    'Japan',              '+81 9012345678',   false),
  (u08, 'Fatima',   'Al-Zahra',  'fatima.alzahra@ascendnow.com', 'United Arab Emirates','+971 501234567',  false),
  (u09, 'Marcus',   'Johnson',   'marcus.johnson@ascendnow.com', 'United States',      '+1 3125551234',    true),
  (u10, 'Anna',     'Kowalski',  'anna.kowalski@ascendnow.com',  'Poland',             '+48 512345678',    false),
  (u11, 'Raj',      'Patel',     'raj.patel@ascendnow.com',      'India',              '+91 8765432109',   false),
  (u12, 'Sophie',   'Dubois',    'sophie.dubois@ascendnow.com',  'France',             '+33 612345678',    false),
  (u13, 'Ibrahim',  'Yilmaz',    'ibrahim.yilmaz@ascendnow.com', 'Turkey',             '+90 5321234567',   true),
  (u14, 'Mei',      'Lin',       'mei.lin@ascendnow.com',        'China',              '+86 13812345678',  false),
  (u15, 'Daniel',   'Park',      'daniel.park@ascendnow.com',    'South Korea',        '+82 1012345678',   false),
  (u16, 'Amara',    'Diallo',    'amara.diallo@ascendnow.com',   'Senegal',            '+221 771234567',   false),
  (u17, 'Thomas',   'Weber',     'thomas.weber@ascendnow.com',   'Germany',            '+49 15123456789',  false),
  (u18, 'Isabella', 'Romano',    'isabella.romano@ascendnow.com','Italy',              '+39 3123456789',   false),
  (u19, 'Kevin',    'O''Brien',  'kevin.obrien@ascendnow.com',   'Ireland',            '+353 851234567',   false),
  (u20, 'Natasha',  'Ivanova',   'natasha.ivanova@ascendnow.com','Russia',             '+7 9161234567',    true),
  (u21, 'Alex',     'Kim',       'alex.kim@ascendnow.com',       'South Korea',        '+82 1098765432',   false),
  (u22, 'Zara',     'Ahmed',     'zara.ahmed@ascendnow.com',     'Pakistan',           '+92 3001234567',   true);


-- ---------------------------------------------------------
-- Step 3: Teacher subjects
-- Subjects without a curriculum (beyond-academic) get NULL
-- curriculum_id via the LEFT JOIN.
-- ---------------------------------------------------------

INSERT INTO public.teacher_subjects (teacher_id, subject_id, curriculum_id)
SELECT
  t.id,
  s.id,
  c.id
FROM (VALUES
  -- Sarah Chen (PC): Maths + Physics, IBDP
  ('sarah.chen@ascendnow.com',     'Mathematics',                    'IBDP'),
  ('sarah.chen@ascendnow.com',     'Physics',                        'IBDP'),

  -- James Wilson: English IGCSE + Extended Essay IBDP
  ('james.wilson@ascendnow.com',   'English',                        'IGCSE'),
  ('james.wilson@ascendnow.com',   'Extended Essay (EE)',            'IBDP'),

  -- Priya Sharma: Chem + Bio, A Levels
  ('priya.sharma@ascendnow.com',   'Chemistry',                      'A Levels'),
  ('priya.sharma@ascendnow.com',   'Biology',                        'A Levels'),

  -- Ahmed Hassan: Economics IBDP + Biz IBMYP
  ('ahmed.hassan@ascendnow.com',   'Economics',                      'IBDP'),
  ('ahmed.hassan@ascendnow.com',   'Business Management',            'IBMYP'),

  -- Emma Thompson (PC): beyond-academic
  ('emma.thompson@ascendnow.com',  'Creative Writing',               NULL),
  ('emma.thompson@ascendnow.com',  'Blog Writing',                   NULL),
  ('emma.thompson@ascendnow.com',  'College Counselling',            NULL),

  -- Carlos Mendez: Maths + CS, AP
  ('carlos.mendez@ascendnow.com',  'Mathematics',                    'AP'),
  ('carlos.mendez@ascendnow.com',  'Computer Science',               'AP'),

  -- Yuki Tanaka: Global Politics IBDP, History IBMYP, Mandarin IGCSE
  ('yuki.tanaka@ascendnow.com',    'Global Politics',                'IBDP'),
  ('yuki.tanaka@ascendnow.com',    'History',                        'IBMYP'),
  ('yuki.tanaka@ascendnow.com',    'Mandarin',                       'IGCSE'),

  -- Fatima Al-Zahra: Bio + Chem, IGCSE
  ('fatima.alzahra@ascendnow.com', 'Biology',                        'IGCSE'),
  ('fatima.alzahra@ascendnow.com', 'Chemistry',                      'IGCSE'),

  -- Marcus Johnson (PC): college support
  ('marcus.johnson@ascendnow.com', 'College Counselling',            NULL),
  ('marcus.johnson@ascendnow.com', 'College Essays',                 NULL),

  -- Anna Kowalski: French IBDP, Spanish A Levels
  ('anna.kowalski@ascendnow.com',  'French',                         'IBDP'),
  ('anna.kowalski@ascendnow.com',  'Spanish',                        'A Levels'),

  -- Raj Patel: Maths SAT, Physics AP
  ('raj.patel@ascendnow.com',      'Mathematics',                    'SAT'),
  ('raj.patel@ascendnow.com',      'Physics',                        'AP'),

  -- Sophie Dubois: Visual Arts IBDP, Film IBMYP
  ('sophie.dubois@ascendnow.com',  'Visual Arts',                    'IBDP'),
  ('sophie.dubois@ascendnow.com',  'Film',                           'IBMYP'),

  -- Ibrahim Yilmaz (PC): TOK + EE, IBDP
  ('ibrahim.yilmaz@ascendnow.com', 'Theory of Knowledge (TOK)',      'IBDP'),
  ('ibrahim.yilmaz@ascendnow.com', 'Extended Essay (EE)',            'IBDP'),

  -- Mei Lin: Mandarin IGCSE, Japanese A Levels
  ('mei.lin@ascendnow.com',        'Mandarin',                       'IGCSE'),
  ('mei.lin@ascendnow.com',        'Japanese',                       'A Levels'),

  -- Daniel Park: CS IBDP, Design Tech IBMYP
  ('daniel.park@ascendnow.com',    'Computer Science',               'IBDP'),
  ('daniel.park@ascendnow.com',    'Design Technology (DT)',         'IBMYP'),

  -- Amara Diallo: English IBMYP, Global Perspectives IGCSE, French IGCSE
  ('amara.diallo@ascendnow.com',   'English',                        'IBMYP'),
  ('amara.diallo@ascendnow.com',   'Global Perspectives',            'IGCSE'),
  ('amara.diallo@ascendnow.com',   'French',                         'IGCSE'),

  -- Thomas Weber: beyond-academic
  ('thomas.weber@ascendnow.com',   'Public Speaking',                NULL),
  ('thomas.weber@ascendnow.com',   'Content Development',            NULL),

  -- Isabella Romano: Psychology + Global Politics, A Levels
  ('isabella.romano@ascendnow.com','Psychology',                     'A Levels'),
  ('isabella.romano@ascendnow.com','Global Politics',                'A Levels'),

  -- Kevin O'Brien: Maths IGCSE, Economics A Levels
  ('kevin.obrien@ascendnow.com',   'Mathematics',                    'IGCSE'),
  ('kevin.obrien@ascendnow.com',   'Economics',                      'A Levels'),

  -- Natasha Ivanova (PC): TOK IBDP + beyond-academic writing
  ('natasha.ivanova@ascendnow.com','Theory of Knowledge (TOK)',      'IBDP'),
  ('natasha.ivanova@ascendnow.com','Research Writing',               NULL),
  ('natasha.ivanova@ascendnow.com','Writing Development',            NULL),

  -- Alex Kim: Economics + Business Management, AP
  ('alex.kim@ascendnow.com',       'Economics',                      'AP'),
  ('alex.kim@ascendnow.com',       'Business Management',            'AP'),

  -- Zara Ahmed (PC): beyond-academic coaching
  ('zara.ahmed@ascendnow.com',     'Job Application Mentorship',     NULL),
  ('zara.ahmed@ascendnow.com',     'Executive Function Coaching',    NULL),
  ('zara.ahmed@ascendnow.com',     'Passion Project',                NULL)

) AS pairs (teacher_email, subject_name, curriculum_name)
JOIN   public.teachers  t ON t.email  = pairs.teacher_email
JOIN   public.subjects  s ON s.name   = pairs.subject_name
LEFT JOIN public.curricula c ON c.name = pairs.curriculum_name;

END $$;

-- =========================================================
-- VERIFY
-- =========================================================
-- SELECT t.first_name, t.last_name,
--        t.is_performance_coach AS pc,
--        count(ts.id)           AS subject_count
-- FROM   public.teachers t
-- LEFT JOIN public.teacher_subjects ts ON ts.teacher_id = t.id
-- GROUP BY t.id, t.first_name, t.last_name, t.is_performance_coach
-- ORDER BY t.first_name;
