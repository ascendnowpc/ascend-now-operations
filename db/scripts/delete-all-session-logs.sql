-- ============================================================================
-- Delete all session logs and reset everything derived from them
-- ============================================================================
-- Purpose: wipe session_logs entirely (e.g. before a clean re-import) and
-- also clear out the records that are snapshots/aggregates built FROM
-- session_logs, so nothing stale is left behind:
--
--   - invoices / invoice_line_items   -> frozen snapshots generated from
--                                        session_logs for a date range
--                                        (invoice_line_items cascades from
--                                        invoices via ON DELETE CASCADE)
--   - monthly_reports /
--     monthly_report_teacher_stats    -> locked monthly aggregates computed
--                                        from session_logs (teacher_stats
--                                        cascades from monthly_reports via
--                                        ON DELETE CASCADE)
--
-- NOT touched by this script (not derived from session_logs):
--   - student_packages.total_hours_purchased  -> maintained from package_topups
--   - package_topups                          -> independent purchase ledger
--
-- student_packages.hours_used is never stored — it's always computed live
-- from session_logs, so once session_logs is empty it will simply read 0
-- with no further action needed.
--
-- Safe to re-run (idempotent: deleting already-empty tables is a no-op).
-- ============================================================================

delete from invoices;          -- cascades to invoice_line_items
delete from monthly_reports;   -- cascades to monthly_report_teacher_stats
delete from session_logs;
