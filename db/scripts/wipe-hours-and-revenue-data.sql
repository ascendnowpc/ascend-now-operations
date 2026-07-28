-- =========================================================
-- db/scripts/wipe-hours-and-revenue-data.sql
-- =========================================================
-- Deletes all data backing: package hours, session logs,
-- teacher hours, and monthly revenue reports.
--
-- Uses TRUNCATE rather than DELETE: both monthly_reports and
-- session_logs carry BEFORE DELETE FOR EACH ROW triggers that
-- permanently block deleting a locked report / a session log inside a
-- locked report month (see migrations 20260702010000 and
-- 20260702020000) — by design, there is no way to unlock one via
-- DELETE or UPDATE. TRUNCATE only fires statement-level triggers, and
-- none are defined here, so it bypasses those row-level locks
-- entirely (this is exactly why TRUNCATE, not DELETE, is required for
-- a hard reset like this one).
--
-- CASCADE pulls in every table that references these three: the
-- monthly_report_*_stats tables (report_id -> monthly_reports),
-- package_topups (student_package_id -> student_packages), and
-- invoice_packages (student_package_id -> student_packages). Invoices
-- themselves are left intact — only their package linkage is cleared.
--
-- Run this directly in the Supabase SQL editor.
-- THIS IS IRREVERSIBLE. Take a backup/export first if unsure.
-- =========================================================

begin;

truncate table
  public.monthly_reports,
  public.session_logs,
  public.student_packages
restart identity cascade;

commit;
