-- Requested cleanup (2026-07-02): wipe session_logs for a clean slate, then
-- remove all inactive subjects and the one inactive program_type row.
-- teacher_subjects rows referencing a deleted subject cascade automatically
-- (teacher_subjects_subject_id_fkey is ON DELETE CASCADE) -- this does drop
-- a handful of real teacher-subject assignments that pointed at legacy,
-- already-deactivated duplicate subjects (e.g. old Physics/Math/Biology rows
-- superseded by curriculum-linked ones, "Job Application Mentorship",
-- "Profile Building", "Writing Development", "Executive Function Coaching",
-- "COA", "College Counselling" subject row) -- confirmed with the user
-- before running.

delete from session_logs;

delete from subjects where is_active = false;

delete from program_types where is_active = false;
