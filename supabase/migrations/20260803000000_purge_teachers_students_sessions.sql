-- One-off data purge: remove ALL teachers (including performance coaches),
-- ALL students, ALL session logs, and every PC/student-related record so the
-- system is reset to a clean slate. Only the admin accounts and the
-- subject/curriculum catalogue + admin-editable settings are kept.
--
-- This deletes only rows, not schema. It runs with session_replication_role =
-- replica so that the delete-guard triggers on locked invoices / locked
-- monthly reports / session logs in a locked month do not block the wipe, and
-- so FK ordering is irrelevant. Re-running is a no-op (everything is already
-- empty). Auth logins (auth.users) and storage objects were purged separately
-- via the Storage / Auth layers and are not part of this SQL migration.

begin;
set local session_replication_role = replica;

-- Homework generator (student-generated content)
delete from question_bank;
delete from grades;
delete from submissions;
delete from session_insights;
delete from generated_papers;
delete from content_uploads;

-- Performance-coach coordinator logs
delete from coordinator_log_package_statuses;
delete from coordinator_log_subjects;
delete from coordinator_logs;

-- Subject notes
delete from subject_notes;

-- Monthly reports + breakout stats
delete from monthly_report_teacher_subject_stats;
delete from monthly_report_student_subject_stats;
delete from monthly_report_subject_stats;
delete from monthly_report_teacher_stats;
delete from monthly_report_student_stats;
delete from monthly_reports;

-- Invoices (incl. locked)
delete from invoice_line_items;
delete from invoice_packages;
delete from invoices;

-- Packages
delete from package_topups;
delete from student_packages;

-- Enrollment pipeline
delete from enrollment_request_payment_proofs;
delete from enrollment_request_packages;
delete from enrollment_requests;

-- Package renewal requests
delete from package_renewal_requests;

-- Session logs + pool resolutions
delete from session_log_pool_resolutions;
delete from session_logs;

-- PC assignments + profiles
delete from pc_student_assignments;
delete from pc_profiles;

-- Zoom invoices (teacher-owned)
delete from zoom_invoices;

-- Teacher <-> subject links
delete from teacher_subjects;

-- Null catalogue references to teachers/users we are about to delete
-- (the catalogue itself is kept).
update subjects  set added_by_teacher_id = null where added_by_teacher_id is not null;
update curricula set added_by_teacher_id = null where added_by_teacher_id is not null;
update subjects  set acknowledged_by_user_id = null
  where acknowledged_by_user_id is not null
    and acknowledged_by_user_id not in (select id from public.users where role = 'admin');
update curricula set acknowledged_by_user_id = null
  where acknowledged_by_user_id is not null
    and acknowledged_by_user_id not in (select id from public.users where role = 'admin');

-- Students and teachers (incl. all performance coaches)
delete from students;
delete from teachers;

-- Identity rows for everyone except admins
delete from public.users where role <> 'admin';

set local session_replication_role = default;
commit;
