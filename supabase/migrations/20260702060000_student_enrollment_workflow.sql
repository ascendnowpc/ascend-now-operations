-- Student enrollment workflow: coordinator submits a "new student" or
-- "renew package" request -> student is emailed an invoice + a link to
-- upload proof of payment -> admin reviews the screenshot and confirms ->
-- student/package is created and a confirmation email goes out.
--
-- Also introduces package-level locking, which the renewal side of this
-- flow depends on: once an admin locks a package (e.g. its hours are fully
-- delivered and reconciled), no more topups or session-log changes are
-- allowed against it, and renewing that course type starts a brand-new,
-- unlinked package instead of extending the locked one. This is a
-- separate mechanism from the existing monthly_reports locking, which
-- freezes a calendar month rather than a specific package.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- 1. students.user_id — links a student to a login account (auth.users),
--    mirroring teachers.user_id. Nullable: existing students have no
--    login; only ones created through confirm-enrollment do.
-- =====================================================================
ALTER TABLE public.students ADD COLUMN user_id uuid REFERENCES public.users(id);
CREATE UNIQUE INDEX students_user_id_key ON public.students(user_id) WHERE user_id IS NOT NULL;

-- =====================================================================
-- 2. Package-level locking.
-- =====================================================================
ALTER TABLE public.student_packages
  ADD COLUMN is_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN locked_by_user_id uuid REFERENCES public.users(id),
  ADD COLUMN locked_hours_used numeric;

-- Packages could previously only ever have one row per (student, course_type)
-- since packages never close. Locking now creates a legitimate second
-- generation, so only one *unlocked* (current) package per student+course
-- type is allowed at a time — any number of locked historical ones can
-- coexist alongside it.
ALTER TABLE public.student_packages DROP CONSTRAINT student_packages_student_id_course_type_id_key;
CREATE UNIQUE INDEX student_packages_one_current_per_course_type
  ON public.student_packages(student_id, course_type_id) WHERE NOT is_locked;

CREATE OR REPLACE FUNCTION public.prevent_topup_on_locked_package()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  pkg_locked boolean;
BEGIN
  SELECT is_locked INTO pkg_locked FROM public.student_packages WHERE id = NEW.student_package_id;
  IF pkg_locked THEN
    RAISE EXCEPTION 'Cannot add hours to a locked package — start a new package instead.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_prevent_topup_on_locked_package
  BEFORE INSERT ON public.package_topups
  FOR EACH ROW EXECUTE FUNCTION public.prevent_topup_on_locked_package();

-- =====================================================================
-- 3. session_logs.student_package_id — which package "generation" a
--    session counts against. Needed once a student can have more than one
--    package over time for the same course type: without this, hours used
--    would keep summing across a locked package and its fresh successor,
--    contradicting "renewal after a lock starts fresh, with no linking
--    back to the old package". Auto-populated by trigger (matches the
--    student's current *unlocked* package for that course type) so
--    existing insert code in the session-log forms needs no changes.
-- =====================================================================
ALTER TABLE public.session_logs ADD COLUMN student_package_id bigint REFERENCES public.student_packages(id);
CREATE INDEX idx_session_logs_student_package_id ON public.session_logs(student_package_id);

CREATE OR REPLACE FUNCTION public.handle_session_log_package_lock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  old_locked boolean := false;
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

  -- Resolve which package (if any) this session now counts against — the
  -- student's current unlocked package for this course type.
  IF NEW.student_id IS NOT NULL AND NEW.course_type_id IS NOT NULL THEN
    SELECT id INTO NEW.student_package_id
      FROM public.student_packages
      WHERE student_id = NEW.student_id AND course_type_id = NEW.course_type_id AND NOT is_locked
      LIMIT 1;
  ELSE
    NEW.student_package_id := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_handle_session_log_package_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.session_logs
  FOR EACH ROW EXECUTE FUNCTION public.handle_session_log_package_lock();

-- =====================================================================
-- 4. enrollment_requests — one row per "add new student" or "renew
--    package" attempt, from invoice email through payment confirmation.
-- =====================================================================
CREATE TABLE public.enrollment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_type text NOT NULL,
  student_id text REFERENCES public.students(id),

  -- Invoice snapshot — entered fresh for a new student, copied from the
  -- existing student record for a renewal. Kept here (rather than read
  -- live off `students`) so the invoice/emails reflect what was true at
  -- request time even if the student record is edited afterwards.
  first_name text NOT NULL,
  last_name text NOT NULL,
  parent_full_name text,
  email text NOT NULL,
  phone_number text,
  address text,
  country text,

  -- Package being purchased/renewed
  course_type_id smallint NOT NULL REFERENCES public.course_types(id),
  program_type_id smallint REFERENCES public.program_types(id),
  hours numeric NOT NULL,
  package_size_label text NOT NULL,
  note text,

  status text NOT NULL DEFAULT 'pending_payment',
  payment_link_token uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_proof_url text,
  payment_proof_uploaded_at timestamptz,
  rejection_reason text,

  resulting_student_package_id bigint REFERENCES public.student_packages(id),
  is_new_package_generation boolean,

  created_by_user_id uuid NOT NULL REFERENCES public.users(id),
  confirmed_by_user_id uuid REFERENCES public.users(id),
  confirmed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT enrollment_requests_type_check CHECK (enrollment_type IN ('new_student', 'renewal')),
  CONSTRAINT enrollment_requests_status_check CHECK (status IN ('pending_payment', 'payment_submitted', 'confirmed', 'rejected')),
  CONSTRAINT enrollment_requests_hours_check CHECK (hours > 0::numeric),
  CONSTRAINT enrollment_requests_renewal_has_student CHECK (enrollment_type = 'new_student' OR student_id IS NOT NULL),
  CONSTRAINT enrollment_requests_payment_link_token_key UNIQUE (payment_link_token)
);

CREATE INDEX idx_enrollment_requests_status ON public.enrollment_requests(status);
CREATE INDEX idx_enrollment_requests_student_id ON public.enrollment_requests(student_id);

CREATE TRIGGER trg_touch_enrollment_requests_updated_at
  BEFORE UPDATE ON public.enrollment_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.enrollment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_enrollment_requests" ON public.enrollment_requests FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enrollment_requests TO authenticated;

-- =====================================================================
-- 5. Storage bucket for payment-proof screenshots. Kept private (unlike
--    avatars/session-summaries/session-invoices) since these are
--    financial screenshots from parents with no Supabase Auth session —
--    uploads happen server-side via the submit-payment-proof edge
--    function using the service-role key, and admins view them through a
--    signed URL (which requires this SELECT policy) rather than a public
--    URL.
-- =====================================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('payment-proofs', 'payment-proofs', false);

CREATE POLICY "Admins can read payment proofs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.is_admin());
