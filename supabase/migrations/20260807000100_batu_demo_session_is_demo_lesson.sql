-- Fix: Batu's 2026-01-01 "Demo Session" is a Demo Lesson, not a College
-- Counselling session, and must not deduct from his package.
--
-- `20260807000000_seed_batu_ozcelik_cc_session_logs.sql` gave all 13 rows of
-- Sumer's sheet `program_type_id` 3 (College Counselling), because that is
-- what the sheet as a whole is. The first row is the exception: its topic is
-- literally "Demo Session" — the free intro call that happens *before* a
-- student buys anything — and the sheet's parent template carries "Demo
-- lesson" as its own Type of Program value alongside Academic / Beyond
-- Academic. So it should never have billed against the College Counselling
-- pool of a package Batu did not yet own on 2026-01-01.
--
-- The shape below is exactly what SessionLogFormView produces for a demo:
--
--   * `program_type_id` → 4, the top-level `type = 'demo_lesson'` row.
--   * `course_type_id`  → NULL. `course_type_id` is billing-only and
--     independent of `program_types`; `PROGRAM_TYPE_TO_COURSE_TYPE_NAME` has
--     no `demo_lesson` entry and there is no `course_types` row named "Demo
--     Lesson", so the form derives NULL here. That NULL is precisely what
--     makes a demo non-billable: `handle_session_log_package_lock()` nulls
--     `student_package_id` when `course_type_id IS NULL`, and `useInvoices`
--     skips any session with no course type, so demos stay off invoices too.
--   * `subject_id`      → NULL. `showSubjectPicker` is false for a demo
--     lesson, so the form never captures one; leaving "College Counselling"
--     on the row would be a subject the UI cannot produce or display here.
--
-- `session_duration_hrs` stays 1 — the call really was an hour, it is simply
-- not deducted from anything. Teacher (Sumer) and coordinator (Rana) are
-- unchanged.
--
-- Two triggers do the rest, which is why this is a plain UPDATE:
--   * `trg_handle_session_log_package_lock` (BEFORE) unlinks the row, since
--     `course_type_id` genuinely changes here and so the "already deducted,
--     keep the assignment" short-circuit correctly does not apply.
--   * `trg_recompute_package_hours_used` (AFTER) drops the College
--     Counselling pool from 10.25 to 9.25 hrs used, over 12 logs.
-- Neither the package nor 2026-01 is locked, so neither guard blocks this.

update public.session_logs
set program_type_id = (select id from public.program_types where type = 'demo_lesson'),
    course_type_id = null,
    subject_id = null
where student_id = 'BATO26-1'
  and session_date = '2026-01-01'
  and topic = 'Demo Session';
