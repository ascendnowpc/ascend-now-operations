-- Data migration: create David, and seed the first of Batu Ozcelik's Passion
-- Project sessions with him.
--
-- Transcribed from the client's "David Session Log (2026)" sheet. That sheet
-- covers many students; Batu appears on 4 rows, all Beyond Academic / Passion
-- Project. (The companion "2025" sheet has no Batu rows at all.) These are
-- the first Beyond Academic sessions in the system.
--
-- **This migration deliberately carries only 2 of the 4 rows** — see the
-- "one email, not four" note at the bottom; `20260807000300` adds the rest.
--
-- ---------------------------------------------------------------------------
-- 1. David
-- ---------------------------------------------------------------------------
-- The sheet is his own log, so it carries no surname or contact details for
-- him — the same situation as Batu's 6 subject teachers, and he is created
-- the same way `20260728120000` created them: first-name-only with
-- `last_name` repeated (it has been NOT NULL + non-blank since 2026-07-29, so
-- it cannot simply be left empty), an `<first-name>@ascendnow.info` address,
-- and placeholder country/phone for an admin to correct in the UI.
--
-- No login is created. The earlier seed built `auth.users` rows by hand for
-- its teachers; that is not repeated here, because a login is only useful
-- once the real address is known — and `create-teacher-with-user` (which
-- would also email credentials) must not be pointed at a placeholder. David
-- exists here purely so his sessions have somewhere to attach.
--
-- `id` is left to `trg_generate_teacher_id`, and `is_active` to its default.

insert into public.teachers (first_name, last_name, country, email, phone_number, is_performance_coach, is_college_counselor)
values ('David', 'David', 'Singapore', 'david@ascendnow.info', '+65 8000 0000', false, false);


-- ---------------------------------------------------------------------------
-- 2. The 2026-05-31 intro — a Demo Lesson, not a billable project session
-- ---------------------------------------------------------------------------
-- The sheet's Session No column reads "INTRO" on this row rather than a
-- number, and the row is Batu's first with David: it is the demo, so it is
-- logged the way `20260807000100` established for Batu's other one —
-- `program_type_id` 4 with `course_type_id` and `subject_id` NULL, which is
-- what keeps a demo off both the package and every invoice.
--
-- Note this is NOT a duplicate of Sumer's 2026-05-31 College Counselling row
-- ("Introductory meeting with David and Batu", 0.5 hrs). Both teachers were
-- on the same intro call and each logs their own time against their own
-- program; David's is 0.75 hrs. Neither deducts from a package.
--
-- Its Video Link cell is empty (the sheet's month-processing marker
-- "Processed on 01.06.26" sits in that area, not a URL), so `video_link` is
-- NULL rather than carrying that marker.

insert into public.session_logs (
  student_id, student_first_name, student_last_name, session_date,
  session_duration_hrs, program_type_id, course_type_id, subject_id,
  curriculum_id, topic, video_link, fathom_summary, teacher_id,
  coordinator_teacher_id, no_show_type, flag_for_coach
)
select
  st.id, st.first_name, st.last_name, '2026-05-31'::date,
  0.75, pt.id, null, null,
  null, 'INTRO', null, null, t.id,
  pc.id, null, false
from public.students st
join public.teachers t on t.email = 'david@ascendnow.info'
join public.teachers pc on pc.email = 'rana.walid@ascendnow.info'
join public.program_types pt on pt.type = 'demo_lesson'
where st.id = 'BATO26-1';


-- ---------------------------------------------------------------------------
-- 3. The first Passion Project session
-- ---------------------------------------------------------------------------
-- Beyond Academic / "Passion Projects" (subject 444). `coordinator_teacher_id`
-- is Rana, Batu's PC — the same rule applied to every other log of his: the
-- sheet's Coordinator column is the PC, and it does not change.
--
-- This session WILL be left unresolved on purpose. Batu's All-In-One bundle
-- has four unlocked Beyond Academic pools (Primary Project, Secondary
-- Project, Extra Hours, Career Exploration), and "Passion Projects" matches
-- none of their `pool_label`s, so `handle_session_log_package_lock()` sets
-- `pool_ambiguous` and leaves `student_package_id` NULL. That is the intended
-- behaviour: only Rana can say which project these hours belong to, from the
-- "Pending Deduction" section of Batu's "Learner's actual hours" tab.
--
-- **One email, not four.** `notify-pool-issue` is invoked once, for this row,
-- immediately after this migration is applied. Its own de-duplication then
-- guarantees silence for the rest: it skips whenever another ambiguous,
-- still-unassigned session already exists for the same (student, course_type,
-- teacher, subject). That is exactly why the remaining two sessions are in a
-- separate follow-up migration rather than here — inserting all three first
-- would make *every* invocation find a sibling pending and skip, sending no
-- email at all. Applying these two migrations in order reproduces what would
-- have happened had David logged the sessions one at a time through the UI:
-- the first notifies his PC, the rest stay quiet.

insert into public.session_logs (
  student_id, student_first_name, student_last_name, session_date,
  session_duration_hrs, program_type_id, course_type_id, subject_id,
  curriculum_id, topic, video_link, fathom_summary, teacher_id,
  coordinator_teacher_id, no_show_type, flag_for_coach
)
select
  st.id, st.first_name, st.last_name, '2026-06-07'::date,
  0.5, pt.id, ct.id, s.id,
  null, 'overview', 'https://fathom.video/share/X-SbKh93jmzhpvxox5CeMs-FncjX2Ghs', null, t.id,
  pc.id, null, false
from public.students st
join public.teachers t on t.email = 'david@ascendnow.info'
join public.teachers pc on pc.email = 'rana.walid@ascendnow.info'
join public.program_types pt on pt.type = 'beyond_academic'
join public.course_types ct on ct.name = 'Beyond Academic'
join public.subjects s on s.name = 'Passion Projects'
where st.id = 'BATO26-1';
