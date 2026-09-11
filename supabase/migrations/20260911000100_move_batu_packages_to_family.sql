-- Move Batu Ozcelik's packages to his family, and drop his sibling's separate
-- Academic pool (2026-09-11). Data only — no schema change.
--
-- Why: family packages shipped earlier today (20260911000000), but Batu's hours
-- were bought long before his parent account existed, so all six of his pools
-- are still student-owned and invisible to his sibling. This is the one-off
-- backfill for the family that predates the feature.
--
-- The family is DEVG26-5 (devender gupta) with two children:
--   BATO26-1  Batu Ozcelik   — 6 packages: Academic 100h, plus an All-In-One
--                              bundle (3 Beyond Academic project pools, an
--                              Extra Hours pool, and College Counselling 40h)
--   TESX26-5  Test1 Sahny    — 1 package: Academic 24h, never used
--
-- Two things happen, and the second is not optional:
--
-- 1. Every one of Batu's packages becomes parent-owned. His existing usage is
--    preserved exactly: `hours_used` is recomputed from `session_logs`, which
--    are keyed on `student_package_id` and untouched here, and each session
--    still carries `student_id = BATO26-1`, so the per-sibling breakdown
--    correctly attributes all 86.75 Academic hours to Batu rather than to the
--    family at large.
--
-- 2. Test1's own Academic pool is deleted. Leaving it would give Test1 TWO
--    Academic candidates — their own and the newly-shared one — and
--    handle_session_log_package_lock() has no way to choose between them:
--    verified by simulation before writing this, an Academic session for Test1
--    lands with `student_package_id = NULL, pool_ambiguous = true`, i.e. it
--    deducts from nothing and waits in the PC's Pending Deduction queue. The
--    pool has never been used (0 sessions, 0 hours), so nothing is lost but the
--    24 purchased hours, which is the trade-off chosen deliberately: the shared
--    Academic pool stays at its original 100h rather than becoming 124h.
--
-- Keyed on student ids, never on `student_packages.id`, so re-reading this file
-- says what it did without a lookup table, and the guards below make it refuse
-- to act on data that doesn't match what was verified.

do $$
declare
  v_parent_id text;
  v_moved int;
  v_sibling_pkg_id bigint;
  v_sibling_sessions int;
begin
  -- ── 1. Batu's packages become the family's ──────────────────────────────
  select parent_id into v_parent_id from public.students where id = 'BATO26-1';

  if v_parent_id is null then
    raise exception 'BATO26-1 has no parent account — nothing to move packages to.';
  end if;

  update public.student_packages
  set student_id = null,
      parent_id  = v_parent_id
  where student_id = 'BATO26-1';

  get diagnostics v_moved = row_count;
  raise notice 'Moved % package(s) from BATO26-1 to family %', v_moved, v_parent_id;

  -- ── 2. Remove the sibling's now-conflicting Academic pool ───────────────
  select id into v_sibling_pkg_id
  from public.student_packages
  where student_id = 'TESX26-5' and course_type_id = 1;

  if v_sibling_pkg_id is not null then
    -- Refuse to delete a pool that has actually been used. It had none when
    -- this was written; if that has changed, the right answer is to merge
    -- rather than drop, and a human should decide that.
    select count(*) into v_sibling_sessions
    from public.session_logs where student_package_id = v_sibling_pkg_id;

    if v_sibling_sessions > 0 then
      raise exception 'TESX26-5''s Academic package % now has % session(s) — refusing to delete it.',
        v_sibling_pkg_id, v_sibling_sessions;
    end if;

    -- `enrollment_request_packages.resulting_student_package_id` is the one FK
    -- pointing here with no ON DELETE behaviour, so it blocks the delete. It
    -- only records which package an enrollment line produced; the enrollment
    -- request itself is left completely intact.
    update public.enrollment_request_packages
    set resulting_student_package_id = null
    where resulting_student_package_id = v_sibling_pkg_id;

    -- package_topups cascades; coordinator_log_package_statuses sets null.
    delete from public.student_packages where id = v_sibling_pkg_id;
    raise notice 'Deleted TESX26-5 Academic package %', v_sibling_pkg_id;
  end if;

  -- ── 3. Assert the end state rather than hoping for it ───────────────────
  if exists (select 1 from public.student_packages where student_id = 'BATO26-1') then
    raise exception 'Some of BATO26-1''s packages are still student-owned.';
  end if;

  if (select count(*) from public.student_packages
      where parent_id = v_parent_id and course_type_id = 1 and not is_locked) <> 1 then
    raise exception 'Expected exactly one unlocked family Academic pool after this migration.';
  end if;
end $$;
