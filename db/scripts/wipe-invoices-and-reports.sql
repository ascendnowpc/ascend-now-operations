-- =========================================================
-- db/scripts/wipe-invoices-and-reports.sql
-- =========================================================
-- Clears out previously-generated invoices (draft, sent, and locked) and
-- monthly reports, along with everything that hangs off them:
--   invoices          -> invoice_line_items, invoice_packages
--   monthly_reports   -> monthly_report_teacher_stats,
--                        monthly_report_student_stats,
--                        monthly_report_teacher_subject_stats,
--                        monthly_report_student_subject_stats,
--                        monthly_report_subject_stats
--
-- Uses TRUNCATE rather than DELETE: a trigger
-- (prevent_locked_invoice_delete) blocks deleting a locked invoice, and
-- likewise for a locked monthly_reports row (prevent_locked_monthly_report_delete)
-- — both are row-level BEFORE DELETE triggers, so TRUNCATE (statement-level
-- only) is the one way to actually clear them out regardless of status.
--
-- Deliberately does NOT touch student_packages, package_topups, or
-- session_logs — this is only resetting generated invoices/reports, not the
-- underlying purchased-hours or session data.
--
-- Run this directly in the Supabase SQL editor (or via Supabase MCP execute_sql).
-- THIS IS IRREVERSIBLE. Take a backup/export first if unsure.
-- =========================================================

begin;

truncate table
  public.invoices,
  public.monthly_reports
restart identity cascade;

commit;
