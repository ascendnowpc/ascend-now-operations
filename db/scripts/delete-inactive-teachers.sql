-- =========================================================
-- db/scripts/delete-inactive-teachers.sql
-- =========================================================
-- Hard-deletes every currently-deactivated teacher (is_active = false) and
-- their login account, rather than leaving them soft-deleted indefinitely.
--
-- Safe only because none of these teachers are referenced by historical
-- data — verify that before running, since every FK from session_logs,
-- invoice_line_items, pc_student_assignments, zoom_invoices,
-- monthly_report_teacher_stats/_subject_stats, session_log_pool_resolutions,
-- curricula/subjects.added_by_teacher_id, and enrollment_requests.pc_teacher_id
-- to teachers.id is NO ACTION (no cascade) — the DELETE below will fail
-- loudly instead of silently destroying that history if any inactive
-- teacher is still referenced. teacher_subjects is the one exception
-- (ON DELETE CASCADE), so it's fine for that to disappear along with them.
--
-- Order matters: teachers.user_id -> users.id is also NO ACTION, so the
-- teacher row must be deleted before its login account.
--
-- Run this directly via the Supabase SQL editor / MCP execute_sql.
-- THIS IS IRREVERSIBLE.
-- =========================================================

delete from teachers where is_active = false;

delete from auth.users
where id in (select id from users where role in ('teacher', 'performance_coach'))
  and id not in (select user_id from teachers where user_id is not null);
