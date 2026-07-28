-- Store a DB-maintained hours_used on student_packages so a package's used
-- hours are an authoritative saved figure, not a client-side re-count of
-- every session on each page load. Kept correct by a trigger on session_logs
-- for insert / update / delete (so edits, moves between packages, duration
-- changes, and no-show-type changes all stay in sync), and backfilled once
-- from the current data.
--
-- "Used" = the sum of session_duration_hrs for the sessions linked to the
-- package, excluding No Show 1 / No Show 2. Those two never carry a
-- student_package_id (only regular sessions and No Show + are linked), so the
-- linkage already excludes them; the no_show_type guard makes it explicit and
-- future-proof. This matches computeHoursUsed()'s package-scoped result.

ALTER TABLE public.student_packages
  ADD COLUMN IF NOT EXISTS hours_used numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recompute_package_hours_used()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pkg_ids bigint[];
  old_pkg bigint := NULL;
  new_pkg bigint := NULL;
  pid bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_pkg := OLD.student_package_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_pkg := NEW.student_package_id; END IF;

  -- On an UPDATE that moves a session between packages, both the old and the
  -- new package must be recomputed.
  pkg_ids := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[old_pkg, new_pkg]) AS x WHERE x IS NOT NULL);

  FOREACH pid IN ARRAY pkg_ids LOOP
    UPDATE public.student_packages sp
    SET hours_used = COALESCE((
      SELECT SUM(sl.session_duration_hrs)
      FROM public.session_logs sl
      WHERE sl.student_package_id = pid
        AND sl.no_show_type IS DISTINCT FROM 'no_show_1'
        AND sl.no_show_type IS DISTINCT FROM 'no_show_2'
    ), 0)
    WHERE sp.id = pid;
  END LOOP;

  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_package_hours_used ON public.session_logs;
CREATE TRIGGER trg_recompute_package_hours_used
AFTER INSERT OR UPDATE OR DELETE ON public.session_logs
FOR EACH ROW EXECUTE FUNCTION public.recompute_package_hours_used();

-- One-time backfill of existing rows.
UPDATE public.student_packages sp
SET hours_used = COALESCE((
  SELECT SUM(sl.session_duration_hrs)
  FROM public.session_logs sl
  WHERE sl.student_package_id = sp.id
    AND sl.no_show_type IS DISTINCT FROM 'no_show_1'
    AND sl.no_show_type IS DISTINCT FROM 'no_show_2'
), 0);
