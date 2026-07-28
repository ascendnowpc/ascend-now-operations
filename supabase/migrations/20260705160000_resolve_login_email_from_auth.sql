-- Make username-based login resolve to the *actual* Supabase Auth login
-- email, not the mutable contact email on public.users.
--
-- The login flow is: username -> get_email_for_username() -> that email is
-- passed to auth.signInWithPassword(). Supabase Auth then matches it against
-- auth.users.email. The old function returned public.users.email, which the
-- profile page edits freely — so any email change desynced the resolver from
-- Auth and locked the account out (observed live on the `test.pc` coach:
-- users.email had been changed to a new address but auth.users.email hadn't,
-- so login handed Auth an address it didn't recognise -> "Incorrect username
-- or password").
--
-- Resolving straight from auth.users.email makes login robust to that desync
-- no matter which code path (self-service profile page, admin teacher edit,
-- or a raw DB edit) changes the contact email: the address handed to Auth is
-- always the one Auth actually authenticates against. (The `update-user-email`
-- edge function additionally keeps the two columns in lockstep, but this is
-- the belt-and-suspenders guarantee that a lockout can't recur.)
--
-- SECURITY DEFINER so it can read auth.users; search_path pinned per the
-- Supabase linter's function_search_path_mutable guidance.

CREATE OR REPLACE FUNCTION public.get_email_for_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  select au.email
  from public.users u
  join auth.users au on au.id = u.id
  where u.username = p_username
  limit 1;
$function$;
