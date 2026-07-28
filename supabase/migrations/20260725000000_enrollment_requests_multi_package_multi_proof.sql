-- Multi-package enrollment requests + multi-file payment proofs.
--
-- Previously one enrollment_requests row = exactly one package (course_type_id/
-- hours/package_size_label/bundle columns) and exactly one payment screenshot
-- (payment_proof_url/payment_proof_uploaded_at). An admin adding a student who
-- buys two packages at once (e.g. Academic + Beyond Academic) had to submit
-- two separate requests, which meant two separate invoice emails and two
-- separate payment links — and a parent paying in two installments had
-- nowhere to attach a second screenshot to the same request.
--
-- This splits both into child tables, one row per line item:
--   enrollment_request_packages       — one row per package on the invoice
--   enrollment_request_payment_proofs — one row per uploaded screenshot
--
-- enrollment_requests itself keeps everything that's genuinely one-per-request
-- (student/contact snapshot, status, payment_link_token, note) — the single
-- invoice email and single payment link still cover every package and accept
-- every proof for the whole request.
--
-- Only 5 live rows exist (all status='confirmed', verified via execute_sql),
-- each with exactly one package and one proof — backfilled 1:1 below, so this
-- is a lossless split, not a data-affecting change.

-- =====================================================================
-- 1. enrollment_request_packages
-- =====================================================================
CREATE TABLE public.enrollment_request_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_request_id uuid NOT NULL REFERENCES public.enrollment_requests(id) ON DELETE CASCADE,
  sort_order smallint NOT NULL DEFAULT 0,

  course_type_id smallint NOT NULL REFERENCES public.course_types(id),
  program_type_id smallint REFERENCES public.program_types(id),
  hours numeric NOT NULL,
  package_size_label text NOT NULL,

  -- Same meaning as the old enrollment_requests columns of the same name —
  -- see the 2026-07-02 bundle-pool-selection migration.
  is_bundle_pool_selection boolean NOT NULL DEFAULT false,
  bundle_pool_label text,

  -- Stamped by review-enrollment-payment on confirm, one per line item (a
  -- multi-package request can create/top-up several different
  -- student_packages rows in the same confirm).
  resulting_student_package_id bigint REFERENCES public.student_packages(id),
  is_new_package_generation boolean,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT enrollment_request_packages_hours_check CHECK (hours > 0::numeric)
);

CREATE INDEX idx_enrollment_request_packages_request_id ON public.enrollment_request_packages(enrollment_request_id);

ALTER TABLE public.enrollment_request_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_enrollment_request_packages" ON public.enrollment_request_packages FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enrollment_request_packages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enrollment_request_packages TO service_role;

-- =====================================================================
-- 2. enrollment_request_payment_proofs
-- =====================================================================
CREATE TABLE public.enrollment_request_payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_request_id uuid NOT NULL REFERENCES public.enrollment_requests(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_enrollment_request_payment_proofs_request_id ON public.enrollment_request_payment_proofs(enrollment_request_id);

ALTER TABLE public.enrollment_request_payment_proofs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all_enrollment_request_payment_proofs" ON public.enrollment_request_payment_proofs FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enrollment_request_payment_proofs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enrollment_request_payment_proofs TO service_role;

-- =====================================================================
-- 3. Backfill — one package row + one proof row (where uploaded) per
--    existing enrollment_requests row.
-- =====================================================================
INSERT INTO public.enrollment_request_packages
  (enrollment_request_id, sort_order, course_type_id, program_type_id, hours,
   package_size_label, is_bundle_pool_selection, bundle_pool_label,
   resulting_student_package_id, is_new_package_generation)
SELECT id, 0, course_type_id, program_type_id, hours, package_size_label,
       is_bundle_pool_selection, bundle_pool_label,
       resulting_student_package_id, is_new_package_generation
FROM public.enrollment_requests;

INSERT INTO public.enrollment_request_payment_proofs (enrollment_request_id, storage_path, uploaded_at)
SELECT id, payment_proof_url, COALESCE(payment_proof_uploaded_at, created_at)
FROM public.enrollment_requests
WHERE payment_proof_url IS NOT NULL;

-- =====================================================================
-- 4. Drop the now-redundant single-package/single-proof columns from
--    enrollment_requests. resulting_student_package_id/is_new_package_generation
--    move to the per-package rows above (a multi-package confirm can create
--    several different student_packages rows, so there's no longer one
--    answer at the request level).
-- =====================================================================
ALTER TABLE public.enrollment_requests DROP CONSTRAINT enrollment_requests_hours_check;

ALTER TABLE public.enrollment_requests
  DROP COLUMN course_type_id,
  DROP COLUMN program_type_id,
  DROP COLUMN hours,
  DROP COLUMN package_size_label,
  DROP COLUMN is_bundle_pool_selection,
  DROP COLUMN bundle_pool_label,
  DROP COLUMN resulting_student_package_id,
  DROP COLUMN is_new_package_generation,
  DROP COLUMN payment_proof_url,
  DROP COLUMN payment_proof_uploaded_at;
