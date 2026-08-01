-- Data migration: Batu Ozcelik's remaining two Passion Project sessions with
-- David, completing the 4 rows transcribed from the "David Session Log
-- (2026)" sheet.
--
-- Split out from `20260807000200` purely so his PC is emailed once rather
-- than not at all. `notify-pool-issue` skips whenever another ambiguous,
-- still-unassigned session already exists for the same (student,
-- course_type, teacher, subject) — so it must be invoked while the 2026-06-07
-- session is the only one pending. With all three inserted first, *every*
-- invocation finds a sibling and skips, and nobody is told.
--
-- **Apply order therefore matters:** `20260807000200`, then invoke
-- `notify-pool-issue` for the 2026-06-07 session, then this. That reproduces
-- what would have happened had David logged the sessions one at a time
-- through the UI — the first notifies his PC, the rest stay quiet.
--
-- Like the 2026-06-07 row, both of these are left unresolved on purpose:
-- Batu's All-In-One bundle has four unlocked Beyond Academic pools and
-- "Passion Projects" matches none of their `pool_label`s, so
-- `handle_session_log_package_lock()` sets `pool_ambiguous` and leaves
-- `student_package_id` NULL for Rana to resolve from the "Pending Deduction"
-- section of Batu's "Learner's actual hours" tab. Once she picks a pool, the
-- recorded (teacher, subject) → pool resolution makes David's future Passion
-- Project sessions land there automatically.

insert into public.session_logs (
  student_id, student_first_name, student_last_name, session_date,
  session_duration_hrs, program_type_id, course_type_id, subject_id,
  curriculum_id, topic, video_link, fathom_summary, teacher_id,
  coordinator_teacher_id, no_show_type, flag_for_coach
)
select
  st.id, st.first_name, st.last_name, v.session_date,
  v.duration_hrs, pt.id, ct.id, s.id,
  null, v.topic, v.video_link, null, t.id,
  pc.id, null, false
from (values
  ('2026-06-14'::date, 0.5,  'Front wheels design', 'https://fathom.video/share/pK1s9-seXEgyWzyeFBnjbL5DEy_tgydb'),
  ('2026-06-20'::date, 0.25, 'fusion 360',          'https://fathom.video/share/8y9L_K7x-ciifw1o8k_WxyZHVS-fzyCq')
) as v(session_date, duration_hrs, topic, video_link)
join public.students st on st.id = 'BATO26-1'
join public.teachers t on t.email = 'david@ascendnow.info'
join public.teachers pc on pc.email = 'rana.walid@ascendnow.info'
join public.program_types pt on pt.type = 'beyond_academic'
join public.course_types ct on ct.name = 'Beyond Academic'
join public.subjects s on s.name = 'Passion Projects';
