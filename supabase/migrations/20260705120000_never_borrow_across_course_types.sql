-- Real bug: when a student had no active pool at all for a session's
-- course_type, handle_session_log_package_lock() "borrowed" the FIRST
-- active pool the student had of ANY course_type (oldest by created_at).
-- Concretely: a student with only an All-In-One bundle (Beyond Academic
-- pools) but no Academic package, logging an Academic session, had those
-- hours silently deducted from the "Primary Project" Beyond Academic pool
-- instead -- an Academic subject showing up inside an All-In-One bundle
-- that should only ever hold Beyond Academic / College Counselling pools.
--
-- Fix: never cross course_type boundaries. When no unlocked pool of the
-- session's own course_type exists, always create a fresh zero-hour pool
-- of that SAME course_type (never borrow a different one), so the overage
-- is visible on the correct package (e.g. a new Academic pool at "1/0 hrs
-- used") and the PC is notified that the package doesn't exist / has been
-- exceeded, per the existing pool_fallback_used email.

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
    -- No unlocked pool of this session's OWN course_type exists for this
    -- student at all. Never block the save, and never borrow a pool of a
    -- DIFFERENT course_type (that's the bug this migration fixes -- an
    -- Academic session must never land in a Beyond Academic pool just
    -- because one happened to exist). Always create a fresh zero-hour pool
    -- of the correct course_type instead, so the overage is visible
    -- directly on the right package (e.g. a new Academic pool at "1/0 hrs
    -- used") and the PC is notified the package doesn't exist / has been
    -- exceeded.
    INSERT INTO public.student_packages (student_id, course_type_id, total_hours_purchased)
      VALUES (NEW.student_id, NEW.course_type_id, 0)
      RETURNING id INTO fallback_pkg_id;

    NEW.student_package_id := fallback_pkg_id;
    NEW.pool_fallback_used := true;
  END IF;

  RETURN NEW;
END;
$function$;
