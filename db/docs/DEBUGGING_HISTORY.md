# Diagnostics Archive

These files are **not** needed to set up a fresh database — that's what the `schema/` folder is for. These are kept purely as a record of the debugging process that led to the final, correct state, in case a similar issue ever resurfaces.

## What happened, in order

1. **`09_create_admin_example.sql`** — first attempt at creating an admin via a one-line SQL command after manually creating the auth account in the dashboard.

2. **`10_fix_role_not_required.sql`** — the original `create_user_profile` trigger required a `role` in metadata or it would throw an error. This blocked Supabase Dashboard's plain "Create user" button (which can't send metadata), so the trigger was loosened to default to `'student'` if no role is given.

3. **`11_make_admin.sql`** — promote-to-admin attempt using the loosened trigger.

4. **`12_diagnostic.sql`** — checked for leftover/orphaned rows after a failed creation attempt.

5. **`13_cleanup_orphaned_user.sql`** — removed orphaned rows so the same email could be retried.

6. **`14_deep_diagnostic.sql`** — deeper check: table structure, whether the trigger was actually attached/enabled.
   - **Discovery: the trigger showed `tgenabled = 0` (disabled).**

7. **`15_enable_trigger_and_check_grants.sql`** — attempted `ALTER TABLE auth.users ENABLE TRIGGER ...` directly.
   - **Discovery: blocked with `must be owner of table users`** — Supabase's managed `auth` schema doesn't allow direct ownership-level changes from the SQL Editor role.

8. **`16_recreate_trigger.sql`** — worked around the ownership restriction by `DROP`+`CREATE` instead of `ALTER ... ENABLE` (creating a trigger doesn't require table ownership the way altering one does).

9. **`18_check_function_source.sql` / `19_force_fix_function.sql`** — verified the live function body, then force-recreated it with `DROP FUNCTION ... CASCADE` to eliminate any possibility of a stale cached version.

10. **`20_fix_user_role_type_resolution.sql`** — hit a `type "user_role" does not exist` error after the force-fix, caused by the function not being schema-qualified. Fixed by explicitly referencing `public.user_role` and setting `search_path = public` on the function.

11. **`21_fix_login_lookup.sql`** — once account creation worked, login itself broke: the username→email lookup ran as an anonymous (`anon`) request, which the original RLS policy (read own row only) couldn't satisfy since nobody is authenticated yet at that point. Fixed by adding `get_email_for_username()`, a narrow `SECURITY DEFINER` function that only ever returns an email, never a full row.

12. **`22_remove_permissive_policy_after_deploy.sql`** — cleanup step to remove a temporary overly-broad policy once the frontend was updated to use the safer function instead.

13. **`23_check_id_match.sql` / `24_check_active_policies.sql`** — after login succeeded, profile-loading still failed with "permission denied for table users." Checked whether the user's `auth.users.id` matched their `public.users.id` (it did) and whether RLS policies were intact (they were).

14. **`25_check_grants_readonly.sql`** — checked actual `GRANT`s on the table directly.
    - **Root cause found: `authenticated` and `anon` had ZERO base grants (no SELECT/INSERT/UPDATE) on `public.users`.** RLS policies were correct the entire time, but RLS only filters rows on top of base grants — it doesn't replace them. Every request was being blocked before RLS was ever evaluated.

15. **`26_fix_missing_grants.sql`** — the actual fix: granted `SELECT/INSERT/UPDATE` to `authenticated` and minimal `SELECT` to `anon` across all tables. This is now folded into `schema/06_grants.sql` as a permanent, required part of fresh setup.

## Key lesson

**RLS policies and base table GRANTs are two separate layers.** A policy can be perfectly correct and still result in "permission denied" if the underlying role was never granted base access to the table at all. Always check both when debugging an access issue — `information_schema.role_table_grants` is the fastest way to verify grants exist.
