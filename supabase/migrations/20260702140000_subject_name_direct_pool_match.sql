-- A session's subject can itself unambiguously name one of a student's
-- concurrent pools -- e.g. the "Career Exploration" subject (Beyond
-- Academic) exactly matches the "Career Exploration" pool an All-In-One
-- bundle creates. When that's the case there's no real ambiguity to ask a
-- PC about: deduct directly from the pool whose pool_label equals the
-- session's subject name. This check runs before the existing (teacher,
-- subject) sticky-resolution lookup, and only matters when more than one
-- concurrent unlocked pool exists for the course_type (the single-pool case
-- was already unambiguous).

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
    -- Direct match: the session's own subject name exactly equals one of
    -- the candidate pools' pool_label (e.g. subject "Career Exploration"
    -- under an All-In-One bundle's "Career Exploration" pool). That alone
    -- unambiguously identifies the intended pool, so it takes priority over
    -- the (teacher, subject) sticky resolution and never needs a PC.
    IF NEW.subject_id IS NOT NULL THEN
      SELECT sp.id INTO resolved_pkg_id
        FROM public.student_packages sp
        JOIN public.subjects s ON s.id = NEW.subject_id
        WHERE sp.student_id = NEW.student_id AND sp.course_type_id = NEW.course_type_id
          AND NOT sp.is_locked AND sp.pool_label = s.name
        LIMIT 1;
    END IF;

    -- Only auto-resolve via the sticky cache if the subject-name match
    -- above didn't already settle it, and this exact teacher+subject
    -- combination has been resolved once before by a PC.
    IF resolved_pkg_id IS NULL AND NEW.teacher_id IS NOT NULL THEN
      SELECT r.student_package_id INTO resolved_pkg_id
        FROM public.session_log_pool_resolutions r
        JOIN public.student_packages sp ON sp.id = r.student_package_id
        WHERE r.student_id = NEW.student_id AND r.course_type_id = NEW.course_type_id
          AND r.teacher_id = NEW.teacher_id AND COALESCE(r.subject_id, -1) = COALESCE(NEW.subject_id, -1)
          AND NOT sp.is_locked;
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
    -- course_type so the overage is visible directly on the package (e.g.
    -- "4/0 hrs") instead of the session going unassigned. Either way,
    -- flag it so the PC gets notified.
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
