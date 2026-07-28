-- Restart the ID sequences of every table emptied by the 2026-07-27 purge
-- (see 20260803000000_purge_teachers_students_sessions.sql) so new records
-- number from 1 again — teachers.id -> 1, session_logs.id -> 1, students.id
-- -> 'S1', etc.
--
-- Only sequences whose table is now empty are reset. The kept catalogue /
-- settings sequences (subjects, curricula, curriculum_groups, subject_categories,
-- course_types, program_types, style_templates, coordinator_log_options,
-- bundle_pool_settings, admins) are deliberately left untouched.

-- Human-readable student code ('S' || nextval) -> next student becomes S1
alter sequence students_num_seq restart with 1;
-- Dead sequence from the removed parents feature (kept tidy)
alter sequence parents_num_seq restart with 1;

-- bigint identity / serial PKs on the emptied tables
alter sequence teachers_id_seq restart with 1;
alter sequence teacher_subjects_id_seq restart with 1;
alter sequence session_logs_id_seq restart with 1;
alter sequence session_log_pool_resolutions_id_seq restart with 1;
alter sequence pc_student_assignments_id_seq restart with 1;
alter sequence pc_profiles_id_seq restart with 1;
alter sequence student_packages_id_seq restart with 1;
alter sequence package_topups_id_seq restart with 1;
alter sequence invoices_id_seq restart with 1;
alter sequence invoice_line_items_id_seq restart with 1;
alter sequence invoice_packages_id_seq restart with 1;
alter sequence monthly_reports_id_seq restart with 1;
alter sequence monthly_report_teacher_stats_id_seq restart with 1;
alter sequence monthly_report_teacher_subject_stats_id_seq restart with 1;
alter sequence monthly_report_student_stats_id_seq restart with 1;
alter sequence monthly_report_student_subject_stats_id_seq restart with 1;
alter sequence monthly_report_subject_stats_id_seq restart with 1;
alter sequence zoom_invoices_id_seq restart with 1;
alter sequence subject_notes_id_seq restart with 1;
alter sequence coordinator_logs_id_seq restart with 1;
alter sequence coordinator_log_subjects_id_seq restart with 1;
alter sequence coordinator_log_package_statuses_id_seq restart with 1;
alter sequence content_uploads_id_seq restart with 1;
alter sequence generated_papers_id_seq restart with 1;
alter sequence question_bank_id_seq restart with 1;
alter sequence submissions_id_seq restart with 1;
alter sequence grades_id_seq restart with 1;
alter sequence session_insights_id_seq restart with 1;
