-- The enrollment-workflow edge functions (send-enrollment-invoice,
-- submit-payment-proof, review-enrollment-payment) use the service-role
-- client to read/write enrollment_requests, course_types, students,
-- student_packages, package_topups, and pc_student_assignments.
--
-- service_role in this project does NOT bypass base table GRANTs (contrary
-- to the note in db/docs/VERIFIED_DATABASE_STATE.md's Grants section,
-- which only held because the three pre-existing edge functions happened
-- to only touch the handful of tables service_role already had full
-- grants on: admins, program_types, session_logs, teacher_subjects,
-- teachers, users). Querying any other table as service_role fails with
-- "permission denied for table ..." regardless of RLS, which is exactly
-- what every enrollment-workflow request hit. Fixing that assumption here
-- rather than re-litigating it per table going forward.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enrollment_requests TO service_role;
GRANT SELECT ON TABLE public.course_types TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.students TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.student_packages TO service_role;
GRANT SELECT, INSERT ON TABLE public.package_topups TO service_role;
GRANT SELECT, INSERT ON TABLE public.pc_student_assignments TO service_role;

-- students.id defaults to 'S' || nextval('students_num_seq') — a plain
-- sequence default, not GENERATED ALWAYS AS IDENTITY. The INSERT grant
-- above is not enough on its own for that shape (identity columns don't
-- need this, plain sequence defaults do) — this is the exact same gotcha
-- zoom_invoices hit for `authenticated` (see db/README.md), now hit again
-- for `service_role` on students.
GRANT USAGE ON SEQUENCE public.students_num_seq TO service_role;
