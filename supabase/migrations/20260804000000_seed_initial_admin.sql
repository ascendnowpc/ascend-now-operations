-- Data migration: seed the bootstrap admin account.
--
-- The 2026-08-03 purge left the project with zero users, which means there was
-- no admin left to sign in — and no way to create one through the app, since
-- `/admin/admins` -> `create-admin-with-user` requires an authenticated admin
-- caller. This migration re-creates that first account so the platform can be
-- logged into again; every subsequent admin should be added through the UI.
--
-- Login is by username, not email (see `get_email_for_username`), so the
-- username is the credential that matters here. The email is a routine
-- @ascendnow.com address and only exists because Supabase Auth requires one.
--
-- The password below is a bootstrap credential and is committed in plaintext,
-- matching how the teacher/student seeds already work. Change it from the
-- profile page after the first sign-in.
--
-- NOTE: `trg_create_user_profile` (baseline, on auth.users) is NOT present on
-- the live project — `CREATE TRIGGER` on an `auth`-owned table is a no-op for
-- the migration role — so the `public.users` row is inserted explicitly rather
-- than relying on it. The `on conflict do nothing` guards keep this correct on
-- a database where that trigger *does* fire, and make the whole migration
-- re-runnable.

do $$
declare
  v_user_id  uuid;
  v_username constant text := 'admin@123';
  v_email    constant text := 'admin@ascendnow.com';
  v_password constant text := 'admin@12345test';
  v_fullname constant text := 'Admin';
begin
  if exists (select 1 from public.users where username = v_username) then
    return;
  end if;

  v_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, crypt(v_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_username, 'full_name', v_fullname, 'role', 'admin'),
    now(), now(), '', '', '', ''
  )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id, 'email', v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  )
  on conflict do nothing;

  insert into public.users (id, username, email, full_name, role)
  values (v_user_id, v_username, v_email, v_fullname, 'admin')
  on conflict (id) do nothing;

  insert into public.admins (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;
end $$;
