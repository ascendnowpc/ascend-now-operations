-- Foundation Program / All-In-One packages need multiple concurrent
-- "pools" of the same course_type for one student (e.g. a 10hr general
-- Beyond Academic pool alongside a 24hr Discovery Project pool).
-- Previously handle_session_log_package_lock() only ever had to pick the
-- single unlocked package for a (student, course_type) pair; now it also
-- has to disambiguate *between* multiple concurrently-active pools of the
-- same course_type. Subject/topic data alone can't reliably do that (the
-- same subject can legitimately belong to different pools for different
-- students), so ambiguous sessions are left unresolved for a PC to
-- manually assign once; that choice is then cached per (teacher, subject)
-- so future matching sessions auto-resolve without asking again. See
-- db/docs/VERIFIED_DATABASE_STATE.md for the full resolution model.
--
-- Foundation Program and All-In-One are course_types (see section 0),
-- purely for admin/invoicing grouping -- a session's course_type_id is
-- always set from the teacher's "type of program" pick (Beyond Academic /
-- College Counselling), never from these, so pool-matching in
-- handle_session_log_package_lock() below still keys off each pool's own
-- real course_type_id, completely unaffected by this. Foundation
-- Program's/All-In-One's course_type only tags which pools belong to the
-- same bundle via student_packages.package_type_id, for display.

-- =====================================================================
-- 0. Foundation Program / All-In-One as course_types, for grouping a
--    bundle of pools on the packages UI and on invoices -- not used for
--    session-to-pool matching (see note above). "Foundation Program"
--    already existed as an inactive row from an earlier, abandoned
--    taxonomy; reactivate it rather than duplicate it. "All-In-One" is
--    new.
-- =====================================================================
UPDATE public.course_types SET is_active = true WHERE name = 'Foundation Program';
INSERT INTO public.course_types (name, color, sort_order, is_active) VALUES ('All-In-One', 'purple', 7, true);

-- student_packages.package_type_id — which bundle (if any) a pool belongs
-- to. NULL for every ordinary standalone package. Distinct from
-- course_type_id: e.g. an All-In-One pool has course_type_id = Beyond
-- Academic or College Counselling (what it actually deducts against) and
-- package_type_id = All-In-One (which bundle it's grouped under).
ALTER TABLE public.student_packages ADD COLUMN package_type_id smallint REFERENCES public.course_types(id);
CREATE INDEX idx_student_packages_package_type_id ON public.student_packages(package_type_id);

-- =====================================================================
-- 1. student_packages.pool_label — distinguishes concurrent pools of the
--    same course_type (e.g. "Discovery Project" vs the default/general
--    pool, which stays NULL). Relaxes the one-current-package-per-
--    course-type uniqueness to one-per-(course_type, pool_label); NULLs
--    are coalesced to '' so the *default* (unlabeled) pool is still
--    unique per student+course_type as before — ordinary single-pool
--    students are unaffected.
-- =====================================================================
ALTER TABLE public.student_packages ADD COLUMN pool_label text;

DROP INDEX public.student_packages_one_current_per_course_type;
CREATE UNIQUE INDEX student_packages_one_current_per_course_type
  ON public.student_packages(student_id, course_type_id, COALESCE(pool_label, ''))
  WHERE NOT is_locked;

-- =====================================================================
-- 2. session_logs — two flags replacing what used to be a silent NULL
--    student_package_id. pool_ambiguous means a PC must manually pick
--    among several candidate pools (see handle_session_log_package_lock
--    below). pool_fallback_used means the session was auto-assigned to a
--    pool other than what its own course_type would suggest — either
--    because no pool of that course_type existed yet (borrowed from
--    another active pool, or a fresh zero-hour pool was created), purely
--    informational for the PC.
-- =====================================================================
ALTER TABLE public.session_logs
  ADD COLUMN pool_ambiguous boolean NOT NULL DEFAULT false,
  ADD COLUMN pool_fallback_used boolean NOT NULL DEFAULT false;

-- =====================================================================
-- 3. session_log_pool_resolutions — sticky (teacher, subject) -> pool
--    cache. Once a PC manually resolves an ambiguous session, future
--    sessions from the same teacher on the same subject for the same
--    student auto-resolve to the same pool without asking again. A PC
--    can delete a row here to force the next matching session back into
--    pool_ambiguous — e.g. once they know a project has changed even
--    though the teacher/subject pairing hasn't (nothing in the data can
--    detect that automatically).
-- =====================================================================
CREATE TABLE public.session_log_pool_resolutions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.students(id),
  course_type_id smallint NOT NULL REFERENCES public.course_types(id),
  teacher_id bigint NOT NULL REFERENCES public.teachers(id),
  subject_id smallint REFERENCES public.subjects(id),
  student_package_id bigint NOT NULL REFERENCES public.student_packages(id),
  resolved_by_user_id uuid NOT NULL REFERENCES public.users(id),
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX session_log_pool_resolutions_key
  ON public.session_log_pool_resolutions(student_id, course_type_id, teacher_id, COALESCE(subject_id, -1));
CREATE INDEX idx_session_log_pool_resolutions_student_package_id
  ON public.session_log_pool_resolutions(student_package_id);

ALTER TABLE public.session_log_pool_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_session_log_pool_resolutions" ON public.session_log_pool_resolutions
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "pc_manage_assigned_session_log_pool_resolutions" ON public.session_log_pool_resolutions
  FOR ALL
  USING (public.is_performance_coach() AND student_id IN (SELECT pc_student_assignments.student_id FROM public.pc_student_assignments WHERE pc_student_assignments.pc_teacher_id = public.my_teacher_id() AND pc_student_assignments.unassigned_at IS NULL))
  WITH CHECK (public.is_performance_coach() AND student_id IN (SELECT pc_student_assignments.student_id FROM public.pc_student_assignments WHERE pc_student_assignments.pc_teacher_id = public.my_teacher_id() AND pc_student_assignments.unassigned_at IS NULL));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.session_log_pool_resolutions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.session_log_pool_resolutions TO service_role;

-- =====================================================================
-- 4. handle_session_log_package_lock() — rewritten to resolve among
--    multiple concurrent unlocked pools of the same course_type, and to
--    always leave the teacher able to save regardless of package state.
--    Now SECURITY DEFINER (matching is_admin()/is_performance_coach()
--    and the other elevated-privilege functions in this codebase): a
--    plain teacher has no RLS access to student_packages or
--    session_log_pool_resolutions, but this trigger must be able to
--    read/write both regardless of who is logging the session.
-- =====================================================================
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
    -- Multiple concurrent pools of this course_type (Foundation Program /
    -- All-In-One students). Only auto-resolve if this exact
    -- teacher+subject combination has already been resolved once by a PC
    -- and that resolution still points at an unlocked pool.
    IF NEW.teacher_id IS NOT NULL THEN
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
