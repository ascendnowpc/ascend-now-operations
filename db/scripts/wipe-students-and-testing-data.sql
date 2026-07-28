-- =========================================================
-- db/scripts/wipe-students-and-testing-data.sql
-- =========================================================
-- Clears every student-related row for a clean testing slate:
-- all session_logs, all students, and everything that only
-- exists because a student exists — packages/topups, invoices,
-- enrollment requests ("payment requests"), pc assignments,
-- pool resolutions, monthly per-student stats, and the login
-- accounts (auth.users, cascading to public.users) for any
-- student created by the enrollment workflow.
--
-- Left untouched: teachers, admins, subjects/curricula/program
-- types/course types (the catalogue), zoom_invoices, and
-- monthly_reports themselves (only the per-student breakout
-- rows inside them are cleared, via the CASCADE below).
--
-- As of the 2026-07-07 student/parent dashboard merge there is no
-- separate `parents` table or parent role anymore — the former
-- parent/guardian's name and phone are plain fields on the
-- `students` row itself, so wiping students wipes that info too,
-- with no second table to truncate.
--
-- Mechanism: TRUNCATE ... CASCADE on students pulls in every
-- table with a FK pointing at it, regardless of that FK's own ON
-- DELETE rule (all are NO ACTION — CASCADE here comes from the
-- TRUNCATE statement itself, not the constraints). TRUNCATE also
-- bypasses row-level triggers, so this can't be blocked by a
-- locked-month session_logs trigger the way a plain DELETE could
-- (see wipe-hours-and-revenue-data.sql for the same reasoning).
--
-- Run this directly via the Supabase SQL editor / MCP execute_sql.
-- THIS IS IRREVERSIBLE. Take a backup/export first if unsure.
-- =========================================================

begin;

-- Pulls in: enrollment_requests, invoices (+ invoice_line_items,
-- invoice_packages), monthly_report_student_stats,
-- monthly_report_student_subject_stats, pc_student_assignments,
-- session_log_pool_resolutions, session_logs, student_packages
-- (+ package_topups). Must run BEFORE deleting from auth.users
-- below — students.user_id is a NO ACTION FK, so the login row
-- can't be removed while a student still references it.
truncate table public.students
restart identity cascade;

-- Login accounts for anyone created via the enrollment workflow
-- (role student) — cascades to their public.users row via the
-- users.id -> auth.users.id FK (ON DELETE CASCADE). Admins,
-- teachers, and coaches are untouched (different roles).
delete from auth.users
where id in (select id from public.users where role = 'student');

-- Custom text-id sequence (e.g. S1042) isn't reset by RESTART
-- IDENTITY above since students.id isn't an identity column —
-- reset it explicitly so fresh test data starts clean at S1.
alter sequence public.students_num_seq restart with 1;

commit;

-- =========================================================
-- VERIFY (optional — run after)
-- =========================================================
-- select 'students' t, count(*) from public.students
-- union all select 'session_logs', count(*) from public.session_logs
-- union all select 'student_packages', count(*) from public.student_packages
-- union all select 'package_topups', count(*) from public.package_topups
-- union all select 'invoices', count(*) from public.invoices
-- union all select 'enrollment_requests', count(*) from public.enrollment_requests
-- union all select 'pc_student_assignments', count(*) from public.pc_student_assignments
-- union all select 'session_log_pool_resolutions', count(*) from public.session_log_pool_resolutions
-- union all select 'users (student)', count(*) from public.users where role = 'student';
