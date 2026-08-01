-- Data migration: give Batu Ozcelik an All-In-One package, then seed his 13
-- College Counselling session logs against its College Counselling pool.
--
-- The logs are transcribed from the client's "Sumer Session Log (2026)"
-- sheet — Sumer Broota's own counselling log, which covers ~40 students;
-- these are the 13 rows belonging to Batu. This is the first College
-- Counselling data in the system: every existing session log for Batu is
-- Academic (program type 1), written by one of his 6 subject teachers, and
-- billed against his separate 100-hour Academic package, which this migration
-- does not touch.
--
-- Prerequisites, all already live:
--   * `SUMB26-19` Sumer Broota exists and is flagged `is_college_counselor`
--     (created through the admin UI, so there is no migration for her)
--   * `20260806000100_cc_student_assignments.sql` created the assignment
--     table; the live row `(BATO26-1 → SUMB26-19, active)` is what makes
--     these logs visible to her under the CC RLS policy added by
--     `20260806000200_cc_reads_only_own_session_logs.sql`
--   * `20260706010000_bundle_pool_settings.sql` created and seeded
--     `bundle_pool_settings`, which steps 1 and 2 read the pool shape from
--   * `20260804000200` / `20260804000300` restored Batu and his existing logs


-- ---------------------------------------------------------------------------
-- 1. The All-In-One pools
-- ---------------------------------------------------------------------------
-- All-In-One is a bundle course type: buying it fans out into five labeled
-- pools rather than one package, grouped by `package_type_id` = the bundle's
-- own course_type id. This replicates what review-enrollment-payment does on
-- a confirmed enrollment, driven off `bundle_pool_settings` rather than
-- hardcoding the five rows, so the hours stay whatever an admin has set them
-- to in Admin → Reports → Settings:
--
--   Beyond Academic    "Primary Project"     32 hrs
--   Beyond Academic    "Secondary Project"   24 hrs
--   Beyond Academic    "Extra Hours"         16 hrs
--   Beyond Academic    "Career Exploration"  10 hrs
--   College Counselling (no label)           40 hrs   ← the logs below land here
--
-- `student_packages_one_current_per_course_type` keeps this idempotent-ish:
-- Batu has no Beyond Academic or College Counselling pool today, so all five
-- inserts are new and a re-run would fail loudly rather than duplicate.

insert into public.student_packages (student_id, course_type_id, package_type_id, pool_label)
select 'BATO26-1', pool_ct.id, bundle_ct.id, b.pool_label
from public.bundle_pool_settings b
join public.course_types pool_ct on pool_ct.name = b.course_type_name
join public.course_types bundle_ct on bundle_ct.name = 'All-In-One'
where b.bundle_name = 'All-In-One';


-- ---------------------------------------------------------------------------
-- 2. The hours
-- ---------------------------------------------------------------------------
-- Hours are never written straight onto `total_hours_purchased` — they arrive
-- as a `package_topups` row and `on_package_topup_inserted()` adds them up.
-- Same path the edge function uses, and the same path Batu's existing
-- 100-hour Academic package was created through.

insert into public.package_topups (
  student_package_id, hours_added, package_size_label, note, added_by_user_id
)
select
  sp.id,
  b.hours,
  'All-In-One — ' || coalesce(b.pool_label, b.course_type_name),
  'Backfill: All-In-One package recorded alongside Batu''s College Counselling session logs.',
  u.id
from public.student_packages sp
join public.course_types pool_ct on pool_ct.id = sp.course_type_id
join public.course_types bundle_ct on bundle_ct.name = 'All-In-One'
join public.bundle_pool_settings b
  on b.bundle_name = 'All-In-One'
 and b.course_type_name = pool_ct.name
 and coalesce(b.pool_label, '') = coalesce(sp.pool_label, '')
join public.users u on u.email = 'admin@ascendnow.com'
where sp.student_id = 'BATO26-1'
  and sp.package_type_id = bundle_ct.id;


-- ---------------------------------------------------------------------------
-- 3. The session logs
-- ---------------------------------------------------------------------------
-- Both teacher columns are joined by email rather than hardcoded id, matching
-- `20260804000300_reseed_batu_ozcelik_session_logs.sql`. Note the INNER JOINs:
-- if either teacher were missing this insert would silently write zero rows.
--
-- `student_package_id` is filled in by handle_session_log_package_lock(),
-- which finds exactly one unlocked College Counselling pool for Batu — the
-- one step 1 just created — and links all 13 rows to it, 0 ambiguous and 0
-- fallback. Ordering matters: run before step 1 these would each have been
-- flagged `pool_fallback_used` against an ad-hoc zero-hour pool instead.
-- Result: 10.25 of the bundle's 40 College Counselling hours used.
--
-- Three transcription decisions, all confirmed with the client:
--
-- 1. `teacher_id` is Sumer on all 13 rows. She ran the sessions — it is her
--    session log — even though her role here is counsellor rather than
--    subject teacher.
--
-- 2. `coordinator_teacher_id` is Rana Walid Abdelaal on all 13 rows. The
--    coordinator column is the student's Performance Coach, and Batu's PC is
--    Rana throughout; the sheet's Coordinator cell says "Sumer" on 3 rows
--    (03-14, 04-04, 05-31) and is blank on the first (01-01, his demo), but
--    the PC does not actually change, so the sheet's value is not carried
--    over. This also matches all 69 of his existing logs.
--
-- 3. Durations are rounded to the nearest quarter hour. The sheet records
--    Fathom's raw decimal call lengths (0.4, 0.6, 0.8, 1.1, 1.4), which
--    `session_logs_session_duration_hrs_check` rejects — session logging in
--    this system is quarter-hour granular. The 7 affected rows carry the
--    sheet's original figure in a trailing comment. Total logged is 10.25 hrs
--    against 10.1 hrs of actual call time.
--
-- One row has no recording: 2026-07-17, where the sheet's Video Link cell
-- reads "WhatsApp (Network Issue)" instead of a Fathom URL. `video_link` is
-- left null rather than storing that note as though it were a link.

insert into public.session_logs (
  student_id, student_first_name, student_last_name, session_date,
  session_duration_hrs, program_type_id, course_type_id, subject_id,
  curriculum_id, topic, video_link, fathom_summary, teacher_id,
  coordinator_teacher_id, no_show_type, flag_for_coach
)
select
  st.id, st.first_name, st.last_name, v.session_date,
  v.duration_hrs, pt.id, ct.id, s.id,
  null, v.topic, v.video_link, null, cc.id,
  pc.id, null, false
from (values
  ('2026-01-01'::date, 1, 'Demo Session', 'https://fathom.video/share/M_V2GPjZMJTGbhYiBxcsuUAygcfbKVo_'),
  ('2026-01-13'::date, 1, 'SUMAC Application', 'https://fathom.video/share/hSA-ZzutGWV_ZALA1Jysz4pnct-kj54W'),
  ('2026-02-03'::date, 0.75, 'Project Idea for MIT competition and summer schools', 'https://fathom.video/share/jVNL5_K2dpxh7aK49-zzjCuQzh_swNbC'),  -- sheet: 0.8 hrs
  ('2026-03-04'::date, 1, 'Summer School Applications', 'https://fathom.video/share/1oyDpM9d8v2mAyGymyjT7sAZzTyeDYus'),
  ('2026-03-08'::date, 1.5, 'Summer School Applications', 'https://fathom.video/share/zn-1sTysyrcUDsEyzqhyu6Xq6meBSc3-'),  -- sheet: 1.4 hrs
  ('2026-03-12'::date, 0.5, 'Academic perfomance and summer school discussion', 'https://fathom.video/share/NmMWxPsnnyhkwia--WT2uxJHHZw_CnZm'),
  ('2026-03-13'::date, 1, 'Stanford summer school essay', 'https://fathom.video/share/cikZfRFzyzKt9TTs-5MxHyrPvR4eJxBz'),
  ('2026-03-14'::date, 1, 'Stanford summer school application', 'https://fathom.video/share/6qDVEwy76e_f5FhcE3F6HtQVuYza1x48'),  -- sheet: 1.1 hrs
  ('2026-04-04'::date, 0.5, 'Summer School applications follow up', 'https://fathom.video/share/WdsbCv1GaHvRzbRXCJfDsUEPsUNZfvTq'),
  ('2026-04-15'::date, 0.5, 'Broad Project idea discussion', 'https://fathom.video/share/nsNTbH3RWBXMVx5ifG-6g7ufpWrcuN8d'),  -- sheet: 0.4 hrs
  ('2026-05-24'::date, 0.5, 'Summer Plan Batu', 'https://fathom.video/share/a2g5NmVAdyXUGoiw8orpWzKRRCk7zQ4E'),  -- sheet: 0.4 hrs
  ('2026-05-31'::date, 0.5, 'Introductory meeting with David and Batu', 'https://fathom.video/share/wYyo1mJB1m4s4yXyWUaNtdvZfKfZNp3X'),  -- sheet: 0.6 hrs
  ('2026-07-17'::date, 0.5, 'Discussion on profile updates', null)  -- sheet: 0.4 hrs; recording: "WhatsApp (Network Issue)"
) as v(session_date, duration_hrs, topic, video_link)
join public.students st on st.id = 'BATO26-1'
join public.teachers cc on cc.email = 'sumer.broota@ascendnow.info'
join public.teachers pc on pc.email = 'rana.walid@ascendnow.info'
join public.program_types pt on pt.name = 'College Counselling'
join public.course_types ct on ct.name = 'College Counselling'
join public.subjects s on s.name = 'College Counselling';
