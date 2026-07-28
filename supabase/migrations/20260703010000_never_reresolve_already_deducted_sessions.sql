-- Real bug: even after 20260703000000 fixed the *priority* between the
-- sticky resolution and the subject-name match, handle_session_log_package_lock
-- still recomputed student_package_id from scratch on every UPDATE to a
-- session_logs row -- including one that had already been resolved and
-- deducted long ago. That meant changing a (teacher, subject) -> pool
-- assignment (or moving one sibling session to a different pool) created a
-- landmine: the next time ANY other already-deducted session from that same
-- teacher+subject got touched for any reason at all (fixing a typo in hours,
-- editing the date, anything), the trigger would silently re-run resolution
-- and drag that historical session onto the new pool too -- even though it
-- was already correctly counted against the old one.
--
-- Fix: once a session has been resolved to a specific package
-- (OLD.student_package_id IS NOT NULL), a later UPDATE no longer re-runs the
-- resolution/subject-match logic at all -- it leaves student_package_id
-- exactly as the row arrives. This covers both cases at once:
--   - An unrelated edit (hours, topic, teacher, subject, date): the column
--     is simply carried forward unchanged by Postgres, so it stays put.
--   - An explicit single-session reassignment (the application's own UPDATE
--     sets student_package_id to a specific new value before this trigger
--     runs): that explicit value is honored exactly, affecting only this
--     one row.
-- The only exception: if the edit actually changes which student or course
-- type the session belongs to, the old package can no longer be valid for
-- it, so resolution still re-runs in that case.
--
-- Only a still-unresolved session (OLD.student_package_id IS NULL -- i.e.
-- still `pool_ambiguous`, or a brand-new INSERT) goes through the
-- resolution/subject-match/ambiguous/fallback logic below. This is what
-- makes "change the project for upcoming sessions" (via the resolution
-- table) and "move one already-logged session" two genuinely separate,
-- non-interfering actions.

CREATE OR REPLACE FUNCTION public.handle_session_log_package_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_locked boolean := false;
  candidate_count int;
  resolved_pkg_id bigint;
  fallback_pkg_id bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.student_package_id IS NOT NULL THEN
      SELECT is_locked INTO old_locked FROM public.student_packages WHERE id = OLD.student_package_id;
    END IF;
    IF old_locked THEN
      RAISE EXCEPTION 'Cannot delete a session log belonging to a locked package.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.student_package_id IS NOT NULL THEN
    SELECT is_locked INTO old_locked FROM public.student_packages WHERE id = OLD.student_package_id;
    IF old_locked THEN
      RAISE EXCEPTION 'Cannot modify a session log belonging to a locked package.';
    END IF;
  END IF;

  -- A session that's already been resolved (deducted from a specific
  -- package) keeps that assignment on any later UPDATE, as long as the
  -- student/course_type it belongs to hasn't actually changed. See the
  -- migration header for why this matters.
  IF TG_OP = 'UPDATE' AND OLD.student_package_id IS NOT NULL
     AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id
     AND NEW.course_type_id IS NOT DISTINCT FROM OLD.course_type_id
  THEN
    NEW.pool_ambiguous := false;
    RETURN NEW;
  END IF;

  NEW.pool_ambiguous := false;
  NEW.pool_fallback_used := false;

  IF NEW.student_id IS NULL OR NEW.course_type_id IS NULL THEN
    NEW.student_package_id := NULL;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO candidate_count
    FROM public.student_packages
    WHERE student_id = NEW.student_id AND course_type_id = NEW.course_type_id AND NOT is_locked;

  IF candidate_count = 1 THEN
    SELECT id INTO NEW.student_package_id
      FROM public.student_packages
      WHERE student_id = NEW.student_id AND course_type_id = NEW.course_type_id AND NOT is_locked;

  ELSIF candidate_count > 1 THEN
    -- 1. Sticky (teacher, subject) resolution first -- an explicit,
    --    previously-recorded assignment always wins.
    IF NEW.teacher_id IS NOT NULL THEN
      SELECT r.student_package_id INTO resolved_pkg_id
        FROM public.session_log_pool_resolutions r
        JOIN public.student_packages sp ON sp.id = r.student_package_id
        WHERE r.student_id = NEW.student_id AND r.course_type_id = NEW.course_type_id
          AND r.teacher_id = NEW.teacher_id AND COALESCE(r.subject_id, -1) = COALESCE(NEW.subject_id, -1)
          AND NOT sp.is_locked;
    END IF;

    -- 2. Direct match: the session's own subject name exactly equals one of
    --    the candidate pools' pool_label -- only when no resolution exists
    --    yet, so a brand-new session still resolves without a PC.
    IF resolved_pkg_id IS NULL AND NEW.subject_id IS NOT NULL THEN
      SELECT sp.id INTO resolved_pkg_id
        FROM public.student_packages sp
        JOIN public.subjects s ON s.id = NEW.subject_id
        WHERE sp.student_id = NEW.student_id AND sp.course_type_id = NEW.course_type_id
          AND NOT sp.is_locked AND sp.pool_label = s.name
        LIMIT 1;
    END IF;

    IF resolved_pkg_id IS NOT NULL THEN
      NEW.student_package_id := resolved_pkg_id;
    ELSE
      NEW.student_package_id := NULL;
      NEW.pool_ambiguous := true;
    END IF;

  ELSE
    -- No unlocked pool of this course_type exists at all. Never block the
    -- save: borrow from another active pool the student has, or if they
    -- have none at all, create a fresh zero-hour pool for the intended
    -- course_type so the overage is visible on the package itself instead
    -- of the session going unassigned. Either way, flag it for the PC.
    SELECT id INTO fallback_pkg_id
      FROM public.student_packages
      WHERE student_id = NEW.student_id AND NOT is_locked
      ORDER BY created_at ASC
      LIMIT 1;

    IF fallback_pkg_id IS NULL THEN
      INSERT INTO public.student_packages (student_id, course_type_id, total_hours_purchased)
        VALUES (NEW.student_id, NEW.course_type_id, 0)
        RETURNING id INTO fallback_pkg_id;
    END IF;

    NEW.student_package_id := fallback_pkg_id;
    NEW.pool_fallback_used := true;
  END IF;

  RETURN NEW;
END;
$function$;
