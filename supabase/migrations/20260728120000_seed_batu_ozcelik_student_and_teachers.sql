-- Data migration: seed the student Batu Ozcelik, his six subject teachers, and
-- his 100-hour Academic package.
--
-- Source: the "Batu" session-log sheet supplied by the client. The sheet only
-- carries each teacher's first name, so the teachers are created with that
-- exact first name and placeholder contact details (these accounts exist for
-- testing the session-log flow). One of them (Anugya) uses the client's own
-- address so she can actually be logged into.
--
-- Rana Walid (already in the database as a performance coach) is Batu's PC and
-- is the coordinator on every one of his session logs.

-- ---------------------------------------------------------------------------
-- 1. Teachers (auth login + public.users via trg_create_user_profile + teachers)
-- ---------------------------------------------------------------------------
do $$
declare
  rec       record;
  v_user_id uuid;
  v_username text;
begin
  for rec in
    select *
    from (values
      ('Anugya',     'sneha203btcse24@igdtuw.ac.in', 'India',          '+91 98110 24567'),
      ('Bharat',     'bharat@ascendnow.info',        'India',          '+91 98220 33145'),
      ('Ylenia',     'ylenia@ascendnow.info',        'Spain',          '+34 612 448 970'),
      ('Magdaleina', 'magdaleina@ascendnow.info',    'Egypt',          '+20 10 2244 8891'),
      ('Jesse',      'jesse@ascendnow.info',         'United Kingdom', '+44 7700 900142'),
      ('Sajjad',     'sajjad@ascendnow.info',        'Pakistan',       '+92 300 4471123')
    ) as t(first_name, email, country, phone_number)
  loop
    v_user_id  := gen_random_uuid();
    v_username := split_part(rec.email, '@', 1);

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      rec.email, crypt(lower(rec.first_name) || '@ascendnow', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', v_username, 'full_name', rec.first_name, 'role', 'teacher'),
      now(), now(), '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
    values (
      gen_random_uuid(), v_user_id, 'email', v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', rec.email, 'email_verified', true, 'phone_verified', false),
      now(), now()
    );

    insert into public.teachers (user_id, first_name, last_name, country, email, phone_number, is_performance_coach)
    values (v_user_id, rec.first_name, null, rec.country, rec.email, rec.phone_number, false);
  end loop;
end $$;

-- Subjects each teacher covers, all IBMYP (curriculum "IBMYP").
insert into public.teacher_subjects (teacher_id, subject_id, curriculum_id)
select t.id, s.id, c.id
from (values
  ('sneha203btcse24@igdtuw.ac.in', 'Integrated Humanities',   'Subject Group 3: Individuals and Societies'),
  ('bharat@ascendnow.info',        'Extended Mathematics',    'Subject Group 5: Mathematics'),
  ('ylenia@ascendnow.info',        'Spanish',                 'Subject Group 2: Language Acquisition'),
  ('magdaleina@ascendnow.info',    'Personal Project',        'Core Requirements'),
  ('magdaleina@ascendnow.info',    'English',                 'Subject Group 1: Language and Literature'),
  ('jesse@ascendnow.info',         'Integrated Sciences',     'Subject Group 4: Sciences'),
  ('sajjad@ascendnow.info',        'Integrated Sciences',     'Subject Group 4: Sciences'),
  ('sajjad@ascendnow.info',        'Chemistry',               'Subject Group 4: Sciences')
) as m(teacher_email, subject_name, group_name)
join public.teachers t on t.email = m.teacher_email
join public.curricula c on c.name = 'IBMYP'
join public.curriculum_groups g on g.curriculum_id = c.id and g.name = m.group_name
join public.subjects s on s.curriculum_group_id = g.id and s.name = m.subject_name;

-- ---------------------------------------------------------------------------
-- 2. Student Batu Ozcelik + login, PC assignment, and 100-hour Academic package
-- ---------------------------------------------------------------------------
do $$
declare
  v_user_id  uuid := gen_random_uuid();
  v_email    text := 'snehagupta161006@gmail.com';
  v_username text := 'snehagupta161006';
  v_student_id text;
  v_package_id bigint;
  v_admin_id uuid;
begin
  select id into v_admin_id from public.users where role = 'admin' order by created_at desc limit 1;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, crypt('batu@ascendnow', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_username, 'full_name', 'Batu Ozcelik', 'role', 'student'),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
  values (
    gen_random_uuid(), v_user_id, 'email', v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now()
  );

  insert into public.students (first_name, last_name, email, notification_email, curriculum, country, user_id)
  values ('Batu', 'Ozcelik', v_email, v_email, 'IB MYP', 'Turkey', v_user_id)
  returning id into v_student_id;

  insert into public.pc_student_assignments (student_id, pc_teacher_id)
  select v_student_id, id from public.teachers where email = 'rana.walid@ascendnow.info';

  -- Hours are added through package_topups so on_package_topup_inserted()
  -- rolls them onto total_hours_purchased, exactly like the enrollment flow.
  insert into public.student_packages (student_id, course_type_id, program_type_id, total_hours_purchased)
  select v_student_id, ct.id, pt.id, 0
  from public.course_types ct, public.program_types pt
  where ct.name = 'Academic' and pt.name = 'Academics' and pt.parent_id is null
  returning id into v_package_id;

  insert into public.package_topups (student_package_id, hours_added, package_size_label, note, added_by_user_id)
  values (v_package_id, 100, '100 hours', 'Initial academic package', v_admin_id);
end $$;
