-- Every existing package is Batu's, individually (2026-09-12). Data only — no
-- schema change.
--
-- Why: `20260911000100_move_batu_packages_to_family.sql` moved all six of
-- Batu's pools onto the household so his sibling could draw on them, and
-- `20260912000000_shared_package_members.sql` then backfilled both children as
-- members of each. Neither reflects what was actually bought: the hours were
-- sold for Batu. The one session logged against the shared Academic pool for
-- his sibling (0.75 hrs, 2026-09-11) was a test of that sharing, not a lesson
-- anyone delivered.
--
-- So the household keeps no hours at all. Sharing stays fully built — the
-- members table, the triggers, the `is_shareable` rule, the add-package form —
-- it just has no live data, and every shared package from here on is one an
-- admin deliberately creates and names two children on.
--
-- Three steps, in this order for a reason:
--   1. The sibling's session goes first, so `recompute_package_hours_used()`
--      takes its 0.75 hrs back off the Academic pool while that pool still
--      exists — leaving 86.75, all Batu's, which is what it was before sharing.
--   2. The membership rows go next. They may only point at a parent-owned
--      package (`validate_student_package_member()`), so clearing them before
--      the ownership flip is what keeps that invariant true at every moment
--      rather than only at the end.
--   3. The pools become Batu's. `validate_shared_package_course_type()` passes
--      trivially here — it returns immediately once `parent_id` is null — so
--      the College Counselling and All-In-One pools that were grandfathered as
--      shared stop being an exception to the shareable rule at all.
--
-- Keyed on the ids of the people involved, never on `student_packages.id`, and
-- guarded so it refuses to act on data that isn't what was verified.

do $$
declare
  v_parent_id text;
  v_sibling_hours numeric;
  v_deleted_sessions int;
  v_deleted_members int;
  v_moved int;
begin
  select parent_id into v_parent_id from public.students where id = 'BATO26-1';
  if v_parent_id is null then
    raise exception 'BATO26-1 has no parent account — this migration has nothing to undo.';
  end if;

  -- ── 1. The sibling's one test session ───────────────────────────────────
  -- Refuse to touch anything if the sibling has built up real history since:
  -- deleting a handful of delivered lessons is not what this migration is for,
  -- and a human should decide what happens to them.
  select coalesce(sum(session_duration_hrs), 0) into v_sibling_hours
  from public.session_logs where student_id = 'TESX26-5';

  if v_sibling_hours > 1 then
    raise exception 'TESX26-5 now has % hrs of session history — refusing to delete it.', v_sibling_hours;
  end if;

  delete from public.session_logs where student_id = 'TESX26-5';
  get diagnostics v_deleted_sessions = row_count;
  raise notice 'Deleted % session log(s) for TESX26-5', v_deleted_sessions;

  -- ── 2. The membership rows ──────────────────────────────────────────────
  delete from public.student_package_members m
  using public.student_packages sp
  where sp.id = m.student_package_id and sp.parent_id = v_parent_id;
  get diagnostics v_deleted_members = row_count;
  raise notice 'Deleted % membership row(s) for family %', v_deleted_members, v_parent_id;

  -- ── 3. The pools become Batu's own ──────────────────────────────────────
  update public.student_packages
  set parent_id  = null,
      student_id = 'BATO26-1'
  where parent_id = v_parent_id;
  get diagnostics v_moved = row_count;
  raise notice 'Moved % package(s) from family % to BATO26-1', v_moved, v_parent_id;

  -- ── 4. Assert the end state rather than hoping for it ───────────────────
  if exists (select 1 from public.student_packages where parent_id is not null) then
    raise exception 'A parent-owned package still exists.';
  end if;
  if exists (select 1 from public.student_package_members) then
    raise exception 'A membership row still exists with no shared package to belong to.';
  end if;
  if exists (select 1 from public.session_logs where student_id = 'TESX26-5') then
    raise exception 'TESX26-5 still has session logs.';
  end if;
end $$;
