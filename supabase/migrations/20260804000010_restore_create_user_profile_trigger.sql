-- Restore the trg_create_user_profile trigger on auth.users.
--
-- The trigger is declared in the baseline schema
-- (20260701000000_baseline_full_schema.sql, section 9) and
-- db/docs/VERIFIED_DATABASE_STATE.md documents it as live, but it is NOT
-- present on this project. Everything in `public` survived — all 16 expected
-- triggers on users/teachers/students/session_logs/package_topups/admins/
-- pc_profiles/student_packages are there and enabled — and only the one
-- trigger that sits on the Supabase-managed `auth` schema is gone, which is
-- the usual outcome when a project is recreated or restored: the auth schema
-- is provisioned by Supabase, so a custom trigger attached to auth.users is
-- not carried across.
--
-- Impact while it was missing: inserting into auth.users did not create the
-- matching public.users row, so
--   * public.teachers / public.admins inserts failed outright on
--     teachers_user_id_fkey / admins_user_id_fkey (FK -> public.users), and
--   * the create-admin-with-user and create-teacher-with-user edge functions,
--     which both rely on this trigger to materialise the users row from
--     user_metadata.role, could not complete.
--
-- Recreated exactly as the baseline declares it. Idempotent.

drop trigger if exists trg_create_user_profile on auth.users;

create trigger trg_create_user_profile
  after insert on auth.users
  for each row execute function public.create_user_profile();
