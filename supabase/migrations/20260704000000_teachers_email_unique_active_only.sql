-- teachers.email was globally UNIQUE, which permanently blocked reusing a
-- deactivated teacher's email for a brand-new teacher account (their old
-- row/email stays on file for history — teachers are never hard-deleted).
-- Relax it to a partial unique index scoped to active teachers only, the
-- same pattern already used elsewhere in this schema (e.g.
-- students_user_id_key, student_packages_one_current_per_course_type).
-- Deactivated teachers keep their real email on file for the record; a new
-- active teacher can now register with that same email once the old one is
-- inactive. Auth-side email uniqueness (Supabase Auth) is handled
-- separately by freeing the old login's email on deactivation — see the
-- deactivate-teacher-with-user edge function.

ALTER TABLE public.teachers DROP CONSTRAINT teachers_email_key;

CREATE UNIQUE INDEX teachers_email_active_key ON public.teachers (email) WHERE is_active;
