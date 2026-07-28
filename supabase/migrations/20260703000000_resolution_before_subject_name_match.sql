-- Bug found while verifying manual pool reassignment: the subject-name ->
-- pool_label direct match (added in 20260702140000) ran BEFORE the sticky
-- (teacher, subject) resolution lookup. Since handle_session_log_package_lock
-- recomputes student_package_id on every UPDATE regardless of what the
-- application tried to set, a PC manually reassigning a session away from
-- its name-matching pool (e.g. moving a "Career Exploration" session off the
-- "Career Exploration" pool) would have the very next write to that row
-- silently snap it back — the explicit, recorded decision in
-- session_log_pool_resolutions never got a chance to apply.
--
-- Swaps the priority: the sticky resolution (an explicit, previously-made
-- decision — which is exactly what assignSessionToPool() writes whenever a
-- PC picks or reassigns a pool) now wins over the implicit subject-name
-- match. The subject-name match still applies whenever no resolution has
-- been recorded yet, so a brand-new "Career Exploration" session still
-- auto-resolves without needing a PC — nothing changes for the common case,
-- this only fixes the case where a PC has explicitly chosen otherwise.

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
    -- 1. Sticky (teacher, subject) resolution first -- an explicit,
    --    previously-recorded decision (including a PC's manual
    --    reassignment) takes precedence over any implicit match.
    IF NEW.teacher_id IS NOT NULL THEN
      SELECT r.student_package_id INTO resolved_pkg_id
        FROM public.session_log_pool_resolutions r
        JOIN public.student_packages sp ON sp.id = r.student_package_id
        WHERE r.student_id = NEW.student_id AND r.course_type_id = NEW.course_type_id
          AND r.teacher_id = NEW.teacher_id AND COALESCE(r.subject_id, -1) = COALESCE(NEW.subject_id, -1)
          AND NOT sp.is_locked;
    END IF;

    -- 2. Direct match: the session's own subject name exactly equals one of
    --    the candidate pools' pool_label (e.g. subject "Career Exploration"
    --    under an All-In-One bundle's "Career Exploration" pool) -- only
    --    when no explicit resolution exists yet, so a brand-new session
    --    still resolves without needing a PC, but a PC's later manual
    --    reassignment sticks instead of being overridden by this.
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
