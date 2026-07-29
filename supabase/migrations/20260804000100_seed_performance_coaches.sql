-- Data migration: create the five Ascend Now performance coaches, each with an
-- empty pc_profiles row.
--
-- The 2026-08-03 purge (20260803000000_purge_teachers_students_sessions.sql)
-- deleted every teacher, including all performance coaches, and the coaches had
-- originally been created through the admin UI rather than a migration — so
-- nothing in supabase/migrations/ could bring them back. Details below were
-- supplied directly by the client. Seeding them here means the roster is
-- reproducible from migrations from now on.
--
-- This also unblocks the Batu Ozcelik seeds, which both depend on Rana:
--   * 20260728120000 assigns her as Batu's PC via pc_student_assignments
--   * 20260728120100 INNER JOINs teachers on 'rana.walid@ascendnow.info' to
--     fill coordinator_teacher_id on all 69 session logs
-- With no Rana row those joins match nothing and both seeds silently insert
-- zero rows, so this migration has to run before either is replayed.
--
-- Logins follow the established convention — username = email local part,
-- password = <first name>@ascendnow — created by direct auth.users +
-- auth.identities insert, so no welcome emails are sent (same as the Batu
-- seeds, unlike the create-teacher-with-user edge function path).
--
-- NOTE ON `country`: the client supplied names, emails and phone numbers but
-- not countries. The values below are inferred from each phone number's
-- dialling code (+20 -> Egypt, +52 -> Mexico, +91 -> India). That is a strong
-- signal but not a certainty — a coach may hold a number from a country they
-- no longer live in — so these are the one field here worth double-checking in
-- the admin UI.
--
-- is_performance_coach = true fires trg_sync_teacher_pc_role, which keeps
-- users.role in step with the coach flag.
--
-- Idempotent: each coach is skipped if their email already exists.

do $$
declare
  rec        record;
  v_user_id  uuid;
  v_username text;
begin
  for rec in
    select *
    from (values
      ('Michel',     'Sherif',         'michel.sherif@ascendnow.info', 'Egypt',  '+20 12 89743439',    'michel@ascendnow'),
      ('Rana',       'Walid Abdelaal', 'rana.walid@ascendnow.info',    'Egypt',  '+20 107 028 1012',   'rana@ascendnow'),
      ('Miriam',     'Hanna',          'miriam.hanna@ascendnow.info',  'Egypt',  '+20 15 58117118',    'miriam@ascendnow'),
      ('Ana Isabel', 'Galvan',         'ana.galvan@ascendnow.info',    'Mexico', '+52 1 477 107 1415', 'ana@ascendnow'),
      ('Ruchi',      'Steven',         'ruchi.steven@ascendnow.info',  'India',  '+91 98920 84766',    'ruchi@ascendnow')
    ) as t(first_name, last_name, email, country, phone_number, password)
  loop
    if exists (select 1 from public.teachers where email = rec.email) then
      continue;
    end if;

    v_user_id  := gen_random_uuid();
    v_username := split_part(rec.email, '@', 1);

    -- auth.users insert fires trg_create_user_profile, which creates the
    -- matching public.users row with role read from raw_user_meta_data.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      rec.email, crypt(rec.password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'username',  v_username,
        'full_name', rec.first_name || ' ' || rec.last_name,
        'role',      'performance_coach'
      ),
      now(), now(), '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
    values (
      gen_random_uuid(), v_user_id, 'email', v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', rec.email, 'email_verified', true, 'phone_verified', false),
      now(), now()
    );

    insert into public.teachers (user_id, first_name, last_name, country, email, phone_number, is_performance_coach)
    values (v_user_id, rec.first_name, rec.last_name, rec.country, rec.email, rec.phone_number, true);

    -- Empty, unpublished profile. The card's content (about, achievements,
    -- educator experience, responsibilities, education) is each coach's to
    -- write at first login via /teacher/pc-profile; seeding invented copy here
    -- would put made-up claims on a real person's public-facing card.
    -- is_published = false keeps the setup gate in front of them until they
    -- fill it in.
    insert into public.pc_profiles (teacher_id, headline, is_published)
    select id, 'Performance Coach', false
    from public.teachers
    where email = rec.email;
  end loop;
end $$;
