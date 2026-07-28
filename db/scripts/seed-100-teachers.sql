-- =========================================================
-- db/scripts/seed-100-teachers.sql
-- =========================================================
-- Seeds 120 additional teachers with realistic data.
--
-- Run in the Supabase SQL Editor as service role / postgres.
-- Safe to re-run — all inserts use ON CONFLICT DO NOTHING.
--
-- Password for all seeded accounts: AscendNow2024!
-- =========================================================

DO $$
DECLARE
  _uid UUID;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _t (
    uid     UUID    DEFAULT gen_random_uuid(),
    fname   TEXT    NOT NULL,
    lname   TEXT    NOT NULL,
    email   TEXT    NOT NULL,
    phone   TEXT,
    country TEXT,
    is_pc   BOOLEAN DEFAULT false
  ) ON COMMIT DROP;

  INSERT INTO _t (fname, lname, email, phone, country, is_pc) VALUES
    -- ── India (18) ────────────────────────────────────────
    ('Arjun',      'Sharma',      'arjun.sharma@ascendnow.com',      '+91-9812345601', 'India',          false),
    ('Priya',      'Nair',        'priya.nair@ascendnow.com',        '+91-9812345602', 'India',          false),
    ('Rahul',      'Gupta',       'rahul.gupta@ascendnow.com',       '+91-9812345603', 'India',          true),
    ('Ananya',     'Krishnan',    'ananya.krishnan@ascendnow.com',   '+91-9812345604', 'India',          false),
    ('Vikram',     'Mehta',       'vikram.mehta@ascendnow.com',      '+91-9812345605', 'India',          false),
    ('Sneha',      'Iyer',        'sneha.iyer@ascendnow.com',        '+91-9812345606', 'India',          false),
    ('Karthik',    'Reddy',       'karthik.reddy@ascendnow.com',     '+91-9812345607', 'India',          false),
    ('Divya',      'Pillai',      'divya.pillai@ascendnow.com',      '+91-9812345608', 'India',          true),
    ('Rohan',      'Verma',       'rohan.verma@ascendnow.com',       '+91-9812345609', 'India',          false),
    ('Meera',      'Bose',        'meera.bose@ascendnow.com',        '+91-9812345610', 'India',          false),
    ('Suresh',     'Patel',       'suresh.patel@ascendnow.com',      '+91-9812345611', 'India',          false),
    ('Lakshmi',    'Rao',         'lakshmi.rao@ascendnow.com',       '+91-9812345612', 'India',          false),
    ('Aditya',     'Singh',       'aditya.singh@ascendnow.com',      '+91-9812345613', 'India',          true),
    ('Pooja',      'Joshi',       'pooja.joshi@ascendnow.com',       '+91-9812345614', 'India',          false),
    ('Nikhil',     'Kumar',       'nikhil.kumar@ascendnow.com',      '+91-9812345615', 'India',          false),
    ('Swati',      'Desai',       'swati.desai@ascendnow.com',       '+91-9812345616', 'India',          false),
    ('Deepak',     'Malhotra',    'deepak.malhotra@ascendnow.com',   '+91-9812345617', 'India',          false),
    ('Kavya',      'Nambiar',     'kavya.nambiar@ascendnow.com',     '+91-9812345618', 'India',          false),

    -- ── UAE / Middle East (10) ────────────────────────────
    ('Omar',       'Al-Rashidi',  'omar.alrashidi@ascendnow.com',    '+971-501234501', 'UAE',            false),
    ('Fatima',     'Hassan',      'fatima.hassan@ascendnow.com',     '+971-501234502', 'UAE',            true),
    ('Ahmed',      'Al-Mansoori', 'ahmed.almansoori@ascendnow.com',  '+971-501234503', 'UAE',            false),
    ('Layla',      'Al-Farsi',    'layla.alfarsi@ascendnow.com',     '+971-501234504', 'UAE',            false),
    ('Khalid',     'Al-Shamsi',   'khalid.alshamsi@ascendnow.com',   '+971-501234505', 'UAE',            false),
    ('Sara',       'Al-Mazroui',  'sara.almazroui@ascendnow.com',    '+966-501234506', 'Saudi Arabia',   false),
    ('Yusuf',      'Al-Qasimi',   'yusuf.alqasimi@ascendnow.com',    '+974-501234507', 'Qatar',          false),
    ('Nadia',      'Kamal',       'nadia.kamal@ascendnow.com',       '+20-1012345508', 'Egypt',          true),
    ('Tariq',      'Osman',       'tariq.osman@ascendnow.com',       '+20-1012345509', 'Egypt',          false),
    ('Rima',       'Saab',        'rima.saab@ascendnow.com',         '+961-71234510',  'Lebanon',        false),

    -- ── East Asia (12) ────────────────────────────────────
    ('Wei',        'Zhang',       'wei.zhang@ascendnow.com',         '+86-13812345601', 'China',         false),
    ('Ling',       'Chen',        'ling.chen@ascendnow.com',         '+86-13812345602', 'China',         false),
    ('Joon',       'Kim',         'joon.kim@ascendnow.com',          '+82-10-1234-5603','South Korea',   true),
    ('Soo-Yeon',   'Park',        'sooyeon.park@ascendnow.com',      '+82-10-1234-5604','South Korea',   false),
    ('Yuki',       'Tanaka',      'yuki.tanaka@ascendnow.com',       '+81-90-1234-5605','Japan',         false),
    ('Haruto',     'Yamamoto',    'haruto.yamamoto@ascendnow.com',   '+81-90-1234-5606','Japan',         false),
    ('Mei-Ling',   'Wu',          'meiling.wu@ascendnow.com',        '+886-912345607', 'Taiwan',         false),
    ('Bo-Wei',     'Lin',         'bowei.lin@ascendnow.com',         '+886-912345608', 'Taiwan',         false),
    ('Fai',        'Leung',       'fai.leung@ascendnow.com',         '+852-91234509',  'Hong Kong',      true),
    ('Wai',        'Chan',        'wai.chan@ascendnow.com',           '+852-91234510',  'Hong Kong',      false),
    ('Bat-Erdene', 'Gantulga',    'baterdene.gantulga@ascendnow.com','+976-91234511',  'Mongolia',       false),
    ('Xiu',        'Liu',         'xiu.liu@ascendnow.com',           '+86-13812345612', 'China',         false),

    -- ── South-East Asia (8) ───────────────────────────────
    ('Siti',       'Rahimah',     'siti.rahimah@ascendnow.com',      '+60-121234601',  'Malaysia',       false),
    ('Amirul',     'Haziq',       'amirul.haziq@ascendnow.com',      '+60-121234602',  'Malaysia',       false),
    ('Nguyen',     'Thanh',       'nguyen.thanh@ascendnow.com',      '+84-91234603',   'Vietnam',        false),
    ('Le',         'Thi Mai',     'le.thimai@ascendnow.com',         '+84-91234604',   'Vietnam',        false),
    ('Somchai',    'Wongprasert', 'somchai.wongprasert@ascendnow.com','+66-81234605',  'Thailand',       true),
    ('Andrea',     'Santos',      'andrea.santos@ascendnow.com',     '+63-91234606',   'Philippines',    false),
    ('Mark',       'Reyes',       'mark.reyes@ascendnow.com',        '+63-91234607',   'Philippines',    false),
    ('Putri',      'Dewi',        'putri.dewi@ascendnow.com',        '+62-81234608',   'Indonesia',      false),

    -- ── Europe — UK (8) ──────────────────────────────────
    ('Oliver',     'Thompson',    'oliver.thompson@ascendnow.com',   '+44-7712345601', 'United Kingdom', false),
    ('Sophie',     'Williams',    'sophie.williams@ascendnow.com',   '+44-7712345602', 'United Kingdom', true),
    ('James',      'Clarke',      'james.clarke@ascendnow.com',      '+44-7712345603', 'United Kingdom', false),
    ('Emily',      'Harrison',    'emily.harrison@ascendnow.com',    '+44-7712345604', 'United Kingdom', false),
    ('Liam',       'Fletcher',    'liam.fletcher@ascendnow.com',     '+44-7712345605', 'United Kingdom', false),
    ('Charlotte',  'Roberts',     'charlotte.roberts@ascendnow.com', '+44-7712345606', 'United Kingdom', false),
    ('Noah',       'Walker',      'noah.walker@ascendnow.com',       '+44-7712345607', 'United Kingdom', true),
    ('Isla',       'Scott',       'isla.scott@ascendnow.com',        '+44-7712345608', 'United Kingdom', false),

    -- ── Europe — Continental (10) ─────────────────────────
    ('Lucas',      'Müller',      'lucas.muller@ascendnow.com',      '+49-15112345601','Germany',        false),
    ('Anna',       'Schmidt',     'anna.schmidt@ascendnow.com',      '+49-15112345602','Germany',        false),
    ('Mathieu',    'Dubois',      'mathieu.dubois@ascendnow.com',    '+33-612345603',  'France',         false),
    ('Camille',    'Lefebvre',    'camille.lefebvre@ascendnow.com',  '+33-612345604',  'France',         true),
    ('Diego',      'García',      'diego.garcia@ascendnow.com',      '+34-612345605',  'Spain',          false),
    ('Lucia',      'Martínez',    'lucia.martinez@ascendnow.com',    '+34-612345606',  'Spain',          false),
    ('Marco',      'Rossi',       'marco.rossi@ascendnow.com',       '+39-3312345607', 'Italy',          false),
    ('Giulia',     'Ferrari',     'giulia.ferrari@ascendnow.com',    '+39-3312345608', 'Italy',          false),
    ('Pieter',     'Van der Berg','pieter.vanderberg@ascendnow.com', '+31-612345609',  'Netherlands',    true),
    ('Ingrid',     'Lindqvist',   'ingrid.lindqvist@ascendnow.com',  '+46-712345610',  'Sweden',         false),

    -- ── Africa (10) ──────────────────────────────────────
    ('Amara',      'Diallo',      'amara.diallo@ascendnow.com',      '+221-771234601', 'Senegal',        false),
    ('Chioma',     'Okonkwo',     'chioma.okonkwo@ascendnow.com',    '+234-8012345602','Nigeria',        true),
    ('Emeka',      'Adeyemi',     'emeka.adeyemi@ascendnow.com',     '+234-8012345603','Nigeria',        false),
    ('Amina',      'Traore',      'amina.traore@ascendnow.com',      '+225-0712345604','Ivory Coast',    false),
    ('Kwame',      'Asante',      'kwame.asante@ascendnow.com',      '+233-242345605', 'Ghana',          false),
    ('Zinhle',     'Dlamini',     'zinhle.dlamini@ascendnow.com',    '+27-812345606',  'South Africa',   false),
    ('Sipho',      'Nkosi',       'sipho.nkosi@ascendnow.com',       '+27-812345607',  'South Africa',   true),
    ('Nadia',      'Bensalem',    'nadia.bensalem@ascendnow.com',    '+216-22345608',  'Tunisia',        false),
    ('Yosef',      'Bekele',      'yosef.bekele@ascendnow.com',      '+251-912345609', 'Ethiopia',       false),
    ('Fatou',      'Mbaye',       'fatou.mbaye@ascendnow.com',       '+221-771234610', 'Senegal',        false),

    -- ── Americas (14) ────────────────────────────────────
    ('Michael',    'Johnson',     'michael.johnson@ascendnow.com',   '+1-6501234601',  'USA',            false),
    ('Jennifer',   'Davis',       'jennifer.davis@ascendnow.com',    '+1-6501234602',  'USA',            true),
    ('Carlos',     'Rodriguez',   'carlos.rodriguez@ascendnow.com',  '+1-7181234603',  'USA',            false),
    ('Stephanie',  'Brown',       'stephanie.brown@ascendnow.com',   '+1-7181234604',  'USA',            false),
    ('Tyler',      'Wilson',      'tyler.wilson@ascendnow.com',      '+1-4151234605',  'USA',            false),
    ('Maria',      'Lopez',       'maria.lopez@ascendnow.com',       '+52-5512345606', 'Mexico',         false),
    ('Juan',       'Hernández',   'juan.hernandez@ascendnow.com',    '+52-5512345607', 'Mexico',         false),
    ('Valentina',  'Gómez',       'valentina.gomez@ascendnow.com',   '+57-3012345608', 'Colombia',       true),
    ('Santiago',   'Torres',      'santiago.torres@ascendnow.com',   '+54-1112345609', 'Argentina',      false),
    ('Isabela',    'Oliveira',    'isabela.oliveira@ascendnow.com',  '+55-1112345610', 'Brazil',         false),
    ('Lucas',      'Pereira',     'lucas.pereira@ascendnow.com',     '+55-1112345611', 'Brazil',         false),
    ('Camila',     'Fernández',   'camila.fernandez@ascendnow.com',  '+56-912345612',  'Chile',          false),
    ('Ethan',      'Morrison',    'ethan.morrison@ascendnow.com',    '+1-4161234613',  'Canada',         true),
    ('Olivia',     'Bennett',     'olivia.bennett@ascendnow.com',    '+1-6041234614',  'Canada',         false),

    -- ── Oceania (8) ──────────────────────────────────────
    ('Lachlan',    'Hughes',      'lachlan.hughes@ascendnow.com',    '+61-412345601',  'Australia',      false),
    ('Sienna',     'Taylor',      'sienna.taylor@ascendnow.com',     '+61-412345602',  'Australia',      true),
    ('Callum',     'Anderson',    'callum.anderson@ascendnow.com',   '+61-412345603',  'Australia',      false),
    ('Madison',    'White',       'madison.white@ascendnow.com',     '+61-412345604',  'Australia',      false),
    ('Finn',       'Murphy',      'finn.murphy@ascendnow.com',       '+64-212345605',  'New Zealand',    false),
    ('Aroha',      'Tane',        'aroha.tane@ascendnow.com',        '+64-212345606',  'New Zealand',    false),
    ('Mere',       'Tuivaga',     'mere.tuivaga@ascendnow.com',      '+679-9123457',   'Fiji',           false),
    ('Teuila',     'Faleolo',     'teuila.faleolo@ascendnow.com',    '+685-7712458',   'Samoa',          false),

    -- ── Central / South Asia (12) ────────────────────────
    ('Bilal',      'Ahmed',       'bilal.ahmed@ascendnow.com',       '+92-3012345601', 'Pakistan',       false),
    ('Ayesha',     'Malik',       'ayesha.malik@ascendnow.com',      '+92-3012345602', 'Pakistan',       true),
    ('Ravi',       'Thapa',       'ravi.thapa@ascendnow.com',        '+977-9812345603','Nepal',          false),
    ('Suchitra',   'Adhikari',    'suchitra.adhikari@ascendnow.com', '+977-9812345604','Nepal',          false),
    ('Tharanga',   'Perera',      'tharanga.perera@ascendnow.com',   '+94-712345605',  'Sri Lanka',      false),
    ('Nadeesha',   'Fernando',    'nadeesha.fernando@ascendnow.com', '+94-712345606',  'Sri Lanka',      false),
    ('Mariam',     'Sultani',     'mariam.sultani@ascendnow.com',    '+93-712345607',  'Afghanistan',    false),
    ('Nino',       'Kvaratskhelia','nino.kvaratskhelia@ascendnow.com','+995-591234608','Georgia',        false),
    ('Arman',      'Hakobyan',    'arman.hakobyan@ascendnow.com',    '+374-91234609',  'Armenia',        true),
    ('Dinara',     'Seitkali',    'dinara.seitkali@ascendnow.com',   '+7-7012345610',  'Kazakhstan',     false),
    ('Aziz',       'Tursunov',    'aziz.tursunov@ascendnow.com',     '+998-912345611', 'Uzbekistan',     false),
    ('Leyla',      'Hasanova',    'leyla.hasanova@ascendnow.com',    '+994-512345612', 'Azerbaijan',     false);

  -- ── Step 1: Create auth accounts ──────────────────────
  INSERT INTO auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at
  )
  SELECT
    uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    email,
    crypt('AscendNow2024!', gen_salt('bf')),
    now(),
    jsonb_build_object(
      'username',   split_part(email, '@', 1),
      'full_name',  fname || ' ' || lname,
      'role',       'teacher'
    ),
    now(),
    now()
  FROM _t
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.users au WHERE au.email = _t.email
  );

  -- ── Step 2: Insert teacher profiles ───────────────────
  -- public.users rows are created by the auth trigger.
  -- Wait a moment is not needed in SQL; the trigger fires synchronously.
  INSERT INTO public.teachers (
    user_id, first_name, last_name, email,
    phone_number, country, is_performance_coach, is_active
  )
  SELECT
    u.id,
    t.fname,
    t.lname,
    t.email,
    t.phone,
    t.country,
    t.is_pc,
    true
  FROM _t t
  JOIN public.users u ON u.email = t.email
  WHERE NOT EXISTS (
    SELECT 1 FROM public.teachers pt WHERE pt.email = t.email
  );

END $$;

-- =========================================================
-- Step 3: Assign subjects (run after the DO block commits)
-- =========================================================
-- Academic teachers: subject + curriculum pairs
-- Beyond-academic teachers: subject only (curriculum_id = NULL)
-- Uses name-based JOIN so IDs don't need to be hard-coded.
-- =========================================================

INSERT INTO public.teacher_subjects (teacher_id, subject_id, curriculum_id)
SELECT t.id, s.id, c.id
FROM (VALUES
  -- ── Arjun Sharma — Mathematics / Physics
  ('arjun.sharma@ascendnow.com',      'Mathematics',                              'IBDP'),
  ('arjun.sharma@ascendnow.com',      'Physics',                                  'IBDP'),
  ('arjun.sharma@ascendnow.com',      'Mathematics',                              'IGCSE'),

  -- ── Priya Nair — Biology / Chemistry
  ('priya.nair@ascendnow.com',        'Biology',                                  'IBDP'),
  ('priya.nair@ascendnow.com',        'Chemistry',                                'IBDP'),
  ('priya.nair@ascendnow.com',        'Biology',                                  'A Levels'),

  -- ── Rahul Gupta — Economics / Business (PC)
  ('rahul.gupta@ascendnow.com',       'Economics',                                'IBDP'),
  ('rahul.gupta@ascendnow.com',       'Business Management',                      'IBDP'),
  ('rahul.gupta@ascendnow.com',       'Executive Function Coaching',              NULL),

  -- ── Ananya Krishnan — English / TOK
  ('ananya.krishnan@ascendnow.com',   'English',                                  'IBDP'),
  ('ananya.krishnan@ascendnow.com',   'Theory of Knowledge (TOK)',                'IBDP'),

  -- ── Vikram Mehta — Computer Science
  ('vikram.mehta@ascendnow.com',      'Computer Science',                         'IBDP'),
  ('vikram.mehta@ascendnow.com',      'Computer Science',                         'A Levels'),
  ('vikram.mehta@ascendnow.com',      'ICT',                                      'IGCSE'),

  -- ── Sneha Iyer — Chemistry / Physics
  ('sneha.iyer@ascendnow.com',        'Chemistry',                                'A Levels'),
  ('sneha.iyer@ascendnow.com',        'Physics',                                  'A Levels'),
  ('sneha.iyer@ascendnow.com',        'Chemistry',                                'IGCSE'),

  -- ── Karthik Reddy — Mathematics
  ('karthik.reddy@ascendnow.com',     'Mathematics',                              'A Levels'),
  ('karthik.reddy@ascendnow.com',     'Mathematics',                              'IGCSE'),
  ('karthik.reddy@ascendnow.com',     'Mathematics',                              'AP'),

  -- ── Divya Pillai — College Counselling / Essays (PC)
  ('divya.pillai@ascendnow.com',      'College Counselling',                      NULL),
  ('divya.pillai@ascendnow.com',      'College Essays',                           NULL),

  -- ── Rohan Verma — History / Global Politics
  ('rohan.verma@ascendnow.com',       'History',                                  'IBDP'),
  ('rohan.verma@ascendnow.com',       'Global Politics',                          'IBDP'),
  ('rohan.verma@ascendnow.com',       'History',                                  'IGCSE'),

  -- ── Meera Bose — Psychology
  ('meera.bose@ascendnow.com',        'Psychology',                               'IBDP'),
  ('meera.bose@ascendnow.com',        'Psychology',                               'A Levels'),

  -- ── Suresh Patel — Economics / Accounting
  ('suresh.patel@ascendnow.com',      'Economics',                                'A Levels'),
  ('suresh.patel@ascendnow.com',      'Accounting',                               'A Levels'),
  ('suresh.patel@ascendnow.com',      'Economics',                                'IGCSE'),

  -- ── Lakshmi Rao — Biology
  ('lakshmi.rao@ascendnow.com',       'Biology',                                  'IGCSE'),
  ('lakshmi.rao@ascendnow.com',       'Biology',                                  'A Levels'),

  -- ── Aditya Singh — Extended Essay / TOK (PC)
  ('aditya.singh@ascendnow.com',      'Extended Essay (EE)',                      'IBDP'),
  ('aditya.singh@ascendnow.com',      'Theory of Knowledge (TOK)',                'IBDP'),
  ('aditya.singh@ascendnow.com',      'College Counselling',                      NULL),

  -- ── Pooja Joshi — French / Spanish
  ('pooja.joshi@ascendnow.com',       'French',                                   'IBDP'),
  ('pooja.joshi@ascendnow.com',       'Spanish',                                  'IGCSE'),

  -- ── Nikhil Kumar — Mathematics / Computer Science
  ('nikhil.kumar@ascendnow.com',      'Mathematics',                              'AP'),
  ('nikhil.kumar@ascendnow.com',      'Computer Science',                         'AP'),

  -- ── Swati Desai — Geography / ESS
  ('swati.desai@ascendnow.com',       'Geography',                                'IBDP'),
  ('swati.desai@ascendnow.com',       'Environmental Systems & Societies (ESS)', 'IBDP'),

  -- ── Deepak Malhotra — Business / Finance
  ('deepak.malhotra@ascendnow.com',   'Business Management',                      'IGCSE'),
  ('deepak.malhotra@ascendnow.com',   'Finance',                                  'A Levels'),

  -- ── Kavya Nambiar — Visual Arts / Theatre
  ('kavya.nambiar@ascendnow.com',     'Visual Arts',                              'IBDP'),
  ('kavya.nambiar@ascendnow.com',     'Theatre',                                  'IBDP'),

  -- ── Omar Al-Rashidi — Mathematics / Physics
  ('omar.alrashidi@ascendnow.com',    'Mathematics',                              'IBDP'),
  ('omar.alrashidi@ascendnow.com',    'Physics',                                  'IBDP'),

  -- ── Fatima Hassan — College Counselling (PC)
  ('fatima.hassan@ascendnow.com',     'College Counselling',                      NULL),
  ('fatima.hassan@ascendnow.com',     'College Essays',                           NULL),
  ('fatima.hassan@ascendnow.com',     'Executive Function Coaching',              NULL),

  -- ── Ahmed Al-Mansoori — Chemistry / Biology
  ('ahmed.almansoori@ascendnow.com',  'Chemistry',                                'IBDP'),
  ('ahmed.almansoori@ascendnow.com',  'Biology',                                  'IBDP'),

  -- ── Layla Al-Farsi — English / TOK
  ('layla.alfarsi@ascendnow.com',     'English',                                  'IBDP'),
  ('layla.alfarsi@ascendnow.com',     'Theory of Knowledge (TOK)',                'IBDP'),

  -- ── Khalid Al-Shamsi — Mathematics / Economics
  ('khalid.alshamsi@ascendnow.com',   'Mathematics',                              'IGCSE'),
  ('khalid.alshamsi@ascendnow.com',   'Economics',                                'IGCSE'),

  -- ── Sara Al-Mazroui — Psychology / Individuals & Societies
  ('sara.almazroui@ascendnow.com',    'Psychology',                               'IBDP'),
  ('sara.almazroui@ascendnow.com',    'Individuals & Societies (I&S)',            'IBMYP'),

  -- ── Yusuf Al-Qasimi — Business Management
  ('yusuf.alqasimi@ascendnow.com',    'Business Management',                      'A Levels'),
  ('yusuf.alqasimi@ascendnow.com',    'Accounting',                               'IGCSE'),

  -- ── Nadia Kamal — College Counselling / Writing (PC)
  ('nadia.kamal@ascendnow.com',       'College Counselling',                      NULL),
  ('nadia.kamal@ascendnow.com',       'Research Writing',                         NULL),
  ('nadia.kamal@ascendnow.com',       'College Essays',                           NULL),

  -- ── Tariq Osman — Mathematics / Physics
  ('tariq.osman@ascendnow.com',       'Mathematics',                              'IGCSE'),
  ('tariq.osman@ascendnow.com',       'Physics',                                  'IGCSE'),

  -- ── Rima Saab — French / English
  ('rima.saab@ascendnow.com',         'French',                                   'IBDP'),
  ('rima.saab@ascendnow.com',         'English',                                  'IGCSE'),

  -- ── Wei Zhang — Mathematics / Computer Science
  ('wei.zhang@ascendnow.com',         'Mathematics',                              'AP'),
  ('wei.zhang@ascendnow.com',         'Computer Science',                         'AP'),
  ('wei.zhang@ascendnow.com',         'Mathematics',                              'SAT'),

  -- ── Ling Chen — Biology / Chemistry
  ('ling.chen@ascendnow.com',         'Biology',                                  'AP'),
  ('ling.chen@ascendnow.com',         'Chemistry',                                'AP'),

  -- ── Joon Kim — Mathematics / Physics (PC)
  ('joon.kim@ascendnow.com',          'Mathematics',                              'AP'),
  ('joon.kim@ascendnow.com',          'Physics',                                  'AP'),
  ('joon.kim@ascendnow.com',          'Executive Function Coaching',              NULL),

  -- ── Soo-Yeon Park — History / Psychology
  ('sooyeon.park@ascendnow.com',      'History',                                  'AP'),
  ('sooyeon.park@ascendnow.com',      'Psychology',                               'AP'),

  -- ── Yuki Tanaka — Mandarin / Japanese
  ('yuki.tanaka@ascendnow.com',       'Mandarin',                                 'IGCSE'),
  ('yuki.tanaka@ascendnow.com',       'Japanese',                                 'IBDP'),

  -- ── Haruto Yamamoto — Mathematics / Design Technology
  ('haruto.yamamoto@ascendnow.com',   'Mathematics',                              'IBDP'),
  ('haruto.yamamoto@ascendnow.com',   'Design Technology (DT)',                   'IBDP'),

  -- ── Mei-Ling Wu — Economics / Business
  ('meiling.wu@ascendnow.com',        'Economics',                                'AP'),
  ('meiling.wu@ascendnow.com',        'Business Management',                      'AP'),

  -- ── Bo-Wei Lin — Computer Science / ICT
  ('bowei.lin@ascendnow.com',         'Computer Science',                         'IGCSE'),
  ('bowei.lin@ascendnow.com',         'ICT',                                      'IGCSE'),

  -- ── Fai Leung — Passion Project / Public Speaking (PC)
  ('fai.leung@ascendnow.com',         'Passion Project',                          NULL),
  ('fai.leung@ascendnow.com',         'Public Speaking',                          NULL),
  ('fai.leung@ascendnow.com',         'College Counselling',                      NULL),

  -- ── Wai Chan — Mathematics / Physics
  ('wai.chan@ascendnow.com',          'Mathematics',                              'IGCSE'),
  ('wai.chan@ascendnow.com',          'Physics',                                  'IGCSE'),

  -- ── Bat-Erdene — History / Geography
  ('baterdene.gantulga@ascendnow.com','History',                                  'IBMYP'),
  ('baterdene.gantulga@ascendnow.com','Geography',                                'IBMYP'),

  -- ── Xiu Liu — Chemistry / Biology
  ('xiu.liu@ascendnow.com',           'Chemistry',                                'AP'),
  ('xiu.liu@ascendnow.com',           'Biology',                                  'AP'),

  -- ── Siti Rahimah — Mathematics / Physics
  ('siti.rahimah@ascendnow.com',      'Mathematics',                              'IGCSE'),
  ('siti.rahimah@ascendnow.com',      'Physics',                                  'IGCSE'),

  -- ── Amirul Haziq — Business / Economics
  ('amirul.haziq@ascendnow.com',      'Business Management',                      'A Levels'),
  ('amirul.haziq@ascendnow.com',      'Economics',                                'A Levels'),

  -- ── Nguyen Thanh — Mathematics / Computer Science
  ('nguyen.thanh@ascendnow.com',      'Mathematics',                              'AP'),
  ('nguyen.thanh@ascendnow.com',      'Computer Science',                         'AP'),

  -- ── Le Thi Mai — English / Writing
  ('le.thimai@ascendnow.com',         'English',                                  'IGCSE'),
  ('le.thimai@ascendnow.com',         'Creative Writing',                         NULL),

  -- ── Somchai Wongprasert — College Counselling (PC)
  ('somchai.wongprasert@ascendnow.com','College Counselling',                     NULL),
  ('somchai.wongprasert@ascendnow.com','College Essays',                          NULL),

  -- ── Andrea Santos — Biology / Chemistry
  ('andrea.santos@ascendnow.com',     'Biology',                                  'IGCSE'),
  ('andrea.santos@ascendnow.com',     'Chemistry',                                'IGCSE'),

  -- ── Mark Reyes — Mathematics / Economics
  ('mark.reyes@ascendnow.com',        'Mathematics',                              'IGCSE'),
  ('mark.reyes@ascendnow.com',        'Economics',                                'IGCSE'),

  -- ── Putri Dewi — Psychology / Individuals & Societies
  ('putri.dewi@ascendnow.com',        'Psychology',                               'IBDP'),
  ('putri.dewi@ascendnow.com',        'Individuals & Societies (I&S)',            'IBMYP'),

  -- ── Oliver Thompson — Physics / Mathematics
  ('oliver.thompson@ascendnow.com',   'Physics',                                  'A Levels'),
  ('oliver.thompson@ascendnow.com',   'Mathematics',                              'A Levels'),

  -- ── Sophie Williams — College Counselling (PC)
  ('sophie.williams@ascendnow.com',   'College Counselling',                      NULL),
  ('sophie.williams@ascendnow.com',   'College Essays',                           NULL),
  ('sophie.williams@ascendnow.com',   'Journalistic Writing',                     NULL),

  -- ── James Clarke — Chemistry / Biology
  ('james.clarke@ascendnow.com',      'Chemistry',                                'A Levels'),
  ('james.clarke@ascendnow.com',      'Biology',                                  'A Levels'),
  ('james.clarke@ascendnow.com',      'Chemistry',                                'IGCSE'),

  -- ── Emily Harrison — English / Theatre
  ('emily.harrison@ascendnow.com',    'English',                                  'A Levels'),
  ('emily.harrison@ascendnow.com',    'Theatre',                                  'IBDP'),

  -- ── Liam Fletcher — Computer Science
  ('liam.fletcher@ascendnow.com',     'Computer Science',                         'A Levels'),
  ('liam.fletcher@ascendnow.com',     'ICT',                                      'IGCSE'),

  -- ── Charlotte Roberts — History / Geography
  ('charlotte.roberts@ascendnow.com', 'History',                                  'A Levels'),
  ('charlotte.roberts@ascendnow.com', 'Geography',                                'IGCSE'),

  -- ── Noah Walker — Public Speaking / Passion Project (PC)
  ('noah.walker@ascendnow.com',       'Public Speaking',                          NULL),
  ('noah.walker@ascendnow.com',       'Passion Project',                          NULL),
  ('noah.walker@ascendnow.com',       'Executive Function Coaching',              NULL),

  -- ── Isla Scott — Visual Arts / Film
  ('isla.scott@ascendnow.com',        'Visual Arts',                              'A Levels'),
  ('isla.scott@ascendnow.com',        'Film',                                     'IBDP'),

  -- ── Lucas Müller — Mathematics / Physics
  ('lucas.muller@ascendnow.com',      'Mathematics',                              'IBDP'),
  ('lucas.muller@ascendnow.com',      'Physics',                                  'IBDP'),

  -- ── Anna Schmidt — Chemistry / Biology
  ('anna.schmidt@ascendnow.com',      'Chemistry',                                'IBDP'),
  ('anna.schmidt@ascendnow.com',      'Biology',                                  'IBDP'),

  -- ── Mathieu Dubois — French / History
  ('mathieu.dubois@ascendnow.com',    'French',                                   'IBDP'),
  ('mathieu.dubois@ascendnow.com',    'History',                                  'IBDP'),

  -- ── Camille Lefebvre — College Counselling (PC)
  ('camille.lefebvre@ascendnow.com',  'College Counselling',                      NULL),
  ('camille.lefebvre@ascendnow.com',  'Research Writing',                         NULL),

  -- ── Diego García — Mathematics / Economics
  ('diego.garcia@ascendnow.com',      'Mathematics',                              'IBDP'),
  ('diego.garcia@ascendnow.com',      'Economics',                                'IBDP'),

  -- ── Lucia Martínez — Spanish / English
  ('lucia.martinez@ascendnow.com',    'Spanish',                                  'IBDP'),
  ('lucia.martinez@ascendnow.com',    'English',                                  'IGCSE'),

  -- ── Marco Rossi — Design Technology / Computer Science
  ('marco.rossi@ascendnow.com',       'Design Technology (DT)',                   'IBDP'),
  ('marco.rossi@ascendnow.com',       'Computer Science',                         'IBDP'),

  -- ── Giulia Ferrari — Visual Arts / Theatre
  ('giulia.ferrari@ascendnow.com',    'Visual Arts',                              'IBDP'),
  ('giulia.ferrari@ascendnow.com',    'Theatre',                                  'IBDP'),

  -- ── Pieter Van der Berg — Business / Entrepreneurship (PC)
  ('pieter.vanderberg@ascendnow.com', 'Business Management',                      'IBDP'),
  ('pieter.vanderberg@ascendnow.com', 'Entrepreneurship',                         'IBDP'),
  ('pieter.vanderberg@ascendnow.com', 'Executive Function Coaching',              NULL),

  -- ── Ingrid Lindqvist — Environmental Systems / Biology
  ('ingrid.lindqvist@ascendnow.com',  'Environmental Systems & Societies (ESS)', 'IBDP'),
  ('ingrid.lindqvist@ascendnow.com',  'Biology',                                  'IBDP'),

  -- ── Amara Diallo — French / History
  ('amara.diallo@ascendnow.com',      'French',                                   'IGCSE'),
  ('amara.diallo@ascendnow.com',      'History',                                  'IGCSE'),

  -- ── Chioma Okonkwo — College Counselling (PC)
  ('chioma.okonkwo@ascendnow.com',    'College Counselling',                      NULL),
  ('chioma.okonkwo@ascendnow.com',    'College Essays',                           NULL),
  ('chioma.okonkwo@ascendnow.com',    'Writing Development',                      NULL),

  -- ── Emeka Adeyemi — Economics / Business
  ('emeka.adeyemi@ascendnow.com',     'Economics',                                'A Levels'),
  ('emeka.adeyemi@ascendnow.com',     'Business Management',                      'A Levels'),

  -- ── Amina Traore — French / Psychology
  ('amina.traore@ascendnow.com',      'French',                                   'IBDP'),
  ('amina.traore@ascendnow.com',      'Psychology',                               'IBDP'),

  -- ── Kwame Asante — Mathematics / Physics
  ('kwame.asante@ascendnow.com',      'Mathematics',                              'IGCSE'),
  ('kwame.asante@ascendnow.com',      'Physics',                                  'IGCSE'),

  -- ── Zinhle Dlamini — Biology / Chemistry
  ('zinhle.dlamini@ascendnow.com',    'Biology',                                  'A Levels'),
  ('zinhle.dlamini@ascendnow.com',    'Chemistry',                                'A Levels'),

  -- ── Sipho Nkosi — Passion Project / Public Speaking (PC)
  ('sipho.nkosi@ascendnow.com',       'Passion Project',                          NULL),
  ('sipho.nkosi@ascendnow.com',       'Public Speaking',                          NULL),

  -- ── Nadia Bensalem — Mathematics / Physics
  ('nadia.bensalem@ascendnow.com',    'Mathematics',                              'IBDP'),
  ('nadia.bensalem@ascendnow.com',    'Physics',                                  'IBDP'),

  -- ── Yosef Bekele — History / Global Politics
  ('yosef.bekele@ascendnow.com',      'History',                                  'IBDP'),
  ('yosef.bekele@ascendnow.com',      'Global Politics',                          'IBDP'),

  -- ── Fatou Mbaye — French / English
  ('fatou.mbaye@ascendnow.com',       'French',                                   'A Levels'),
  ('fatou.mbaye@ascendnow.com',       'English',                                  'IGCSE'),

  -- ── Michael Johnson — SAT Math / College Counselling
  ('michael.johnson@ascendnow.com',   'Mathematics',                              'SAT'),
  ('michael.johnson@ascendnow.com',   'English',                                  'SAT'),

  -- ── Jennifer Davis — College Counselling (PC)
  ('jennifer.davis@ascendnow.com',    'College Counselling',                      NULL),
  ('jennifer.davis@ascendnow.com',    'College Essays',                           NULL),
  ('jennifer.davis@ascendnow.com',    'Job Application Mentorship',               NULL),

  -- ── Carlos Rodriguez — Mathematics / Computer Science
  ('carlos.rodriguez@ascendnow.com',  'Mathematics',                              'AP'),
  ('carlos.rodriguez@ascendnow.com',  'Computer Science',                         'AP'),

  -- ── Stephanie Brown — Psychology / English
  ('stephanie.brown@ascendnow.com',   'Psychology',                               'AP'),
  ('stephanie.brown@ascendnow.com',   'English',                                  'AP'),

  -- ── Tyler Wilson — TOEFL / IELTS English
  ('tyler.wilson@ascendnow.com',      'English',                                  'TOEFL'),
  ('tyler.wilson@ascendnow.com',      'English',                                  'IELTS'),

  -- ── Maria Lopez — Spanish / English
  ('maria.lopez@ascendnow.com',       'Spanish',                                  'AP'),
  ('maria.lopez@ascendnow.com',       'English',                                  'AP'),

  -- ── Juan Hernández — Economics / History
  ('juan.hernandez@ascendnow.com',    'Economics',                                'AP'),
  ('juan.hernandez@ascendnow.com',    'History',                                  'AP'),

  -- ── Valentina Gómez — College Counselling (PC)
  ('valentina.gomez@ascendnow.com',   'College Counselling',                      NULL),
  ('valentina.gomez@ascendnow.com',   'Blog Writing',                             NULL),

  -- ── Santiago Torres — Mathematics / Physics
  ('santiago.torres@ascendnow.com',   'Mathematics',                              'IBDP'),
  ('santiago.torres@ascendnow.com',   'Physics',                                  'IBDP'),

  -- ── Isabela Oliveira — Biology / Chemistry
  ('isabela.oliveira@ascendnow.com',  'Biology',                                  'IBDP'),
  ('isabela.oliveira@ascendnow.com',  'Chemistry',                                'IBDP'),

  -- ── Lucas Pereira — Computer Science / Design Technology
  ('lucas.pereira@ascendnow.com',     'Computer Science',                         'IBDP'),
  ('lucas.pereira@ascendnow.com',     'Design Technology (DT)',                   'IBDP'),

  -- ── Camila Fernández — Psychology / History
  ('camila.fernandez@ascendnow.com',  'Psychology',                               'IBDP'),
  ('camila.fernandez@ascendnow.com',  'History',                                  'IBDP'),

  -- ── Ethan Morrison — Executive Coaching (PC)
  ('ethan.morrison@ascendnow.com',    'Executive Function Coaching',              NULL),
  ('ethan.morrison@ascendnow.com',    'Passion Project',                          NULL),
  ('ethan.morrison@ascendnow.com',    'College Counselling',                      NULL),

  -- ── Olivia Bennett — English / TOK
  ('olivia.bennett@ascendnow.com',    'English',                                  'A Levels'),
  ('olivia.bennett@ascendnow.com',    'Theory of Knowledge (TOK)',                'IBDP'),

  -- ── Lachlan Hughes — Mathematics / Physics
  ('lachlan.hughes@ascendnow.com',    'Mathematics',                              'IBDP'),
  ('lachlan.hughes@ascendnow.com',    'Physics',                                  'IBDP'),

  -- ── Sienna Taylor — College Counselling (PC)
  ('sienna.taylor@ascendnow.com',     'College Counselling',                      NULL),
  ('sienna.taylor@ascendnow.com',     'College Essays',                           NULL),

  -- ── Callum Anderson — Computer Science / ICT
  ('callum.anderson@ascendnow.com',   'Computer Science',                         'A Levels'),
  ('callum.anderson@ascendnow.com',   'ICT',                                      'IGCSE'),

  -- ── Madison White — Biology / Environmental Systems
  ('madison.white@ascendnow.com',     'Biology',                                  'IBDP'),
  ('madison.white@ascendnow.com',     'Environmental Systems & Societies (ESS)', 'IBDP'),

  -- ── Finn Murphy — Mathematics / Statistics
  ('finn.murphy@ascendnow.com',       'Mathematics',                              'IBDP'),
  ('finn.murphy@ascendnow.com',       'Mathematics',                              'IGCSE'),

  -- ── Aroha Tane — English / Theatre
  ('aroha.tane@ascendnow.com',        'English',                                  'IBDP'),
  ('aroha.tane@ascendnow.com',        'Theatre',                                  'IBDP'),

  -- ── Mere Tuivaga — Creative Writing / Blog Writing
  ('mere.tuivaga@ascendnow.com',      'Creative Writing',                         NULL),
  ('mere.tuivaga@ascendnow.com',      'Blog Writing',                             NULL),

  -- ── Teuila Faleolo — Public Speaking / Writing
  ('teuila.faleolo@ascendnow.com',    'Public Speaking',                          NULL),
  ('teuila.faleolo@ascendnow.com',    'Writing Development',                      NULL),

  -- ── Bilal Ahmed — Mathematics / Physics
  ('bilal.ahmed@ascendnow.com',       'Mathematics',                              'A Levels'),
  ('bilal.ahmed@ascendnow.com',       'Physics',                                  'A Levels'),
  ('bilal.ahmed@ascendnow.com',       'Mathematics',                              'IGCSE'),

  -- ── Ayesha Malik — College Counselling / Essays (PC)
  ('ayesha.malik@ascendnow.com',      'College Counselling',                      NULL),
  ('ayesha.malik@ascendnow.com',      'College Essays',                           NULL),

  -- ── Ravi Thapa — Mathematics / Computer Science
  ('ravi.thapa@ascendnow.com',        'Mathematics',                              'IGCSE'),
  ('ravi.thapa@ascendnow.com',        'Computer Science',                         'IGCSE'),

  -- ── Suchitra Adhikari — Biology / Chemistry
  ('suchitra.adhikari@ascendnow.com', 'Biology',                                  'A Levels'),
  ('suchitra.adhikari@ascendnow.com', 'Chemistry',                                'A Levels'),

  -- ── Tharanga Perera — Economics / Business
  ('tharanga.perera@ascendnow.com',   'Economics',                                'A Levels'),
  ('tharanga.perera@ascendnow.com',   'Business Management',                      'IGCSE'),

  -- ── Nadeesha Fernando — English / Psychology
  ('nadeesha.fernando@ascendnow.com', 'English',                                  'A Levels'),
  ('nadeesha.fernando@ascendnow.com', 'Psychology',                               'A Levels'),

  -- ── Mariam Sultani — French / History
  ('mariam.sultani@ascendnow.com',    'French',                                   'IBDP'),
  ('mariam.sultani@ascendnow.com',    'History',                                  'IBDP'),

  -- ── Nino Kvaratskhelia — Mathematics / Physics
  ('nino.kvaratskhelia@ascendnow.com','Mathematics',                              'IBDP'),
  ('nino.kvaratskhelia@ascendnow.com','Physics',                                  'IBDP'),

  -- ── Arman Hakobyan — College Counselling (PC)
  ('arman.hakobyan@ascendnow.com',    'College Counselling',                      NULL),
  ('arman.hakobyan@ascendnow.com',    'Executive Function Coaching',              NULL),

  -- ── Dinara Seitkali — Biology / Chemistry
  ('dinara.seitkali@ascendnow.com',   'Biology',                                  'IBDP'),
  ('dinara.seitkali@ascendnow.com',   'Chemistry',                                'IBDP'),

  -- ── Aziz Tursunov — Mathematics / Computer Science
  ('aziz.tursunov@ascendnow.com',     'Mathematics',                              'IGCSE'),
  ('aziz.tursunov@ascendnow.com',     'Computer Science',                         'IGCSE'),

  -- ── Leyla Hasanova — English / IELTS
  ('leyla.hasanova@ascendnow.com',    'English',                                  'IELTS'),
  ('leyla.hasanova@ascendnow.com',    'English',                                  'TOEFL')

) AS p(email, sub, cur)
JOIN public.teachers t ON t.email = p.email
JOIN public.subjects  s ON s.name = p.sub
LEFT JOIN public.curricula c ON c.name = p.cur
ON CONFLICT DO NOTHING;

-- =========================================================
-- VERIFY (optional)
-- =========================================================
-- SELECT COUNT(*) AS seeded_teachers FROM public.teachers
-- WHERE email LIKE '%@ascendnow.com%'
-- AND created_at > now() - interval '10 minutes';
