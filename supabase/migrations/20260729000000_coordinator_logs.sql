-- Coordinator Logs — periodic coaching check-ins a Performance Coach (PC) files
-- per student: goals, progress, subject baselines/outcomes, ratings, renewal/
-- upsell signals. Admin + PC only (no plain teacher, no student) — RLS scopes
-- a PC to students currently assigned to them via pc_student_assignments,
-- mirroring package_renewal_requests/student_packages rather than
-- session_logs' blanket-PC-read pattern, since a PC must only reach their own
-- students here.

-- ============================================================================
-- coordinator_log_options — backs 6 admin-editable dropdowns (Settings tab)
-- ============================================================================
create table public.coordinator_log_options (
  id bigint generated always as identity primary key,
  list_key text not null check (list_key in (
    'primary_goal', 'progress_status', 'biggest_challenge',
    'next_action', 'renewal_status', 'referral_status'
  )),
  label text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.users(id),
  unique (list_key, label)
);

comment on table public.coordinator_log_options is 'Admin-editable option lists for Coordinator Logs (Primary Goal, Progress Status, Biggest Challenge, Next Action, Renewal Status, Referral Status), discriminated by list_key. Managed only from Admin -> Reports -> Settings.';

create index coordinator_log_options_list_key_idx on public.coordinator_log_options(list_key);

create trigger trg_touch_coordinator_log_options_updated_at
  before update on public.coordinator_log_options
  for each row execute function public.touch_updated_at();

alter table public.coordinator_log_options enable row level security;

create policy "Admins can manage all coordinator_log_options"
  on public.coordinator_log_options for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "PCs can read active coordinator_log_options"
  on public.coordinator_log_options for select
  to authenticated
  using (is_active and public.is_performance_coach());

grant select, insert, update, delete on table public.coordinator_log_options to authenticated;
grant all on table public.coordinator_log_options to service_role;
grant usage on sequence public.coordinator_log_options_id_seq to authenticated, service_role;

-- Seed data (from the client's spreadsheet dropdowns)
insert into public.coordinator_log_options (list_key, label, sort_order) values
  ('primary_goal', 'Academic Performance', 0),
  ('primary_goal', 'University Placement', 1),
  ('primary_goal', 'Profile Building', 2),
  ('primary_goal', 'Career Exploration', 3),
  ('primary_goal', 'Coaching', 4),

  ('progress_status', 'On Track', 0),
  ('progress_status', 'Slightly Behind', 1),
  ('progress_status', 'At Risk', 2),
  ('progress_status', 'Exceeding Expectations', 3),
  ('progress_status', 'Completed', 4),
  ('progress_status', 'On Pause', 5),

  ('biggest_challenge', 'Motivation', 0),
  ('biggest_challenge', 'Time Management', 1),
  ('biggest_challenge', 'Academic Gaps', 2),
  ('biggest_challenge', 'Confidence', 3),
  ('biggest_challenge', 'Parent Expectations', 4),
  ('biggest_challenge', 'Attendance', 5),
  ('biggest_challenge', 'Homework', 6),
  ('biggest_challenge', 'Exam Stress', 7),
  ('biggest_challenge', 'NA', 8),
  ('biggest_challenge', 'Financial Constraint', 9),

  ('next_action', 'Parent Meeting', 0),
  ('next_action', 'Student Check-in', 1),
  ('next_action', 'Academic Review', 2),
  ('next_action', 'Adjust Learning Plan', 3),
  ('next_action', 'Share Progress Report', 4),
  ('next_action', 'Escalate to Ari', 5),
  ('next_action', 'Completed', 6),
  ('next_action', 'On Pause', 7),

  ('renewal_status', 'Not Due', 0),
  ('renewal_status', 'Upcoming', 1),
  ('renewal_status', 'In Discussion', 2),
  ('renewal_status', 'Renewed', 3),
  ('renewal_status', 'Not Renewing', 4),

  ('referral_status', 'None', 0),
  ('referral_status', 'Potential', 1),
  ('referral_status', 'Requested', 2),
  ('referral_status', 'Referred One Family', 3),
  ('referral_status', 'Referred Multiple Families', 4);

-- ============================================================================
-- coordinator_logs — one row per PC check-in on a student
-- ============================================================================
create table public.coordinator_logs (
  id bigint generated always as identity primary key,
  student_id text not null references public.students(id),
  teacher_id bigint not null references public.teachers(id),
  log_date date not null default current_date,

  course_type_id smallint not null references public.course_types(id),
  profile_building_project text,

  primary_goal_option_id bigint references public.coordinator_log_options(id),
  goal_timeline date,
  progress_status_option_id bigint references public.coordinator_log_options(id),
  biggest_challenge_option_id bigint references public.coordinator_log_options(id),
  next_action_option_id bigint references public.coordinator_log_options(id),

  final_outcome_university_placement text,
  final_outcome_project_achievement text,
  evidence_link_profile_building text,

  student_engagement_rating smallint,
  parent_engagement_rating smallint,
  academic_progress_rating smallint,
  referral_potential_rating smallint,

  renewal_status_option_id bigint references public.coordinator_log_options(id),
  upsell_opportunity text check (upsell_opportunity in ('none', 'low', 'medium', 'high')),
  recommended_upsell_course_type_id smallint references public.course_types(id),
  upsell_timing date,
  referral_status_option_id bigint references public.coordinator_log_options(id),

  ideal_outcome text,
  ideal_outcome_by_when date,

  parent_involvement_rating smallint,
  transformation_outcomes_rating smallint,
  loyalty_retention_rating smallint,
  referral_advocacy_rating smallint,
  parent_belief_rating smallint,

  primary_relationship_owner text check (primary_relationship_owner in ('devi', 'pc_cc', 'ascend_now_system')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint coordinator_logs_ratings_check check (
    (student_engagement_rating is null or student_engagement_rating between 0 and 5) and
    (parent_engagement_rating is null or parent_engagement_rating between 0 and 5) and
    (academic_progress_rating is null or academic_progress_rating between 0 and 5) and
    (referral_potential_rating is null or referral_potential_rating between 0 and 5) and
    (parent_involvement_rating is null or parent_involvement_rating between 0 and 5) and
    (transformation_outcomes_rating is null or transformation_outcomes_rating between 0 and 5) and
    (loyalty_retention_rating is null or loyalty_retention_rating between 0 and 5) and
    (referral_advocacy_rating is null or referral_advocacy_rating between 0 and 5) and
    (parent_belief_rating is null or parent_belief_rating between 0 and 5)
  ),
  -- Safety net for the "month/year only" fields — the app always writes the
  -- 1st of the month (mirrors the session_duration 15-minute-rounding CHECK:
  -- enforced in the DB regardless of how the value gets entered).
  constraint coordinator_logs_month_dates_check check (
    (goal_timeline is null or extract(day from goal_timeline) = 1) and
    (upsell_timing is null or extract(day from upsell_timing) = 1) and
    (ideal_outcome_by_when is null or extract(day from ideal_outcome_by_when) = 1)
  )
);

comment on table public.coordinator_logs is 'Periodic PC coaching check-in per student: goals, progress, final outcomes, ratings, renewal/upsell/referral signals. Repeating history, one row per check-in.';

create index coordinator_logs_student_id_idx on public.coordinator_logs(student_id);
create index coordinator_logs_teacher_id_idx on public.coordinator_logs(teacher_id);
create index coordinator_logs_log_date_idx on public.coordinator_logs(log_date);

create trigger trg_touch_coordinator_logs_updated_at
  before update on public.coordinator_logs
  for each row execute function public.touch_updated_at();

alter table public.coordinator_logs enable row level security;

create policy "Admins can manage all coordinator_logs"
  on public.coordinator_logs for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "PCs can manage coordinator_logs for their assigned students"
  on public.coordinator_logs for all
  to authenticated
  using (
    public.is_performance_coach() and exists (
      select 1 from public.pc_student_assignments a
      where a.student_id = coordinator_logs.student_id
        and a.pc_teacher_id = public.my_teacher_id()
        and a.unassigned_at is null
    )
  )
  with check (
    public.is_performance_coach() and exists (
      select 1 from public.pc_student_assignments a
      where a.student_id = coordinator_logs.student_id
        and a.pc_teacher_id = public.my_teacher_id()
        and a.unassigned_at is null
    )
  );

grant select, insert, update, delete on table public.coordinator_logs to authenticated;
grant all on table public.coordinator_logs to service_role;
grant usage on sequence public.coordinator_logs_id_seq to authenticated, service_role;

-- ============================================================================
-- coordinator_log_subjects — subject + baseline score + final outcome grade,
-- repeatable per coordinator_logs row (fields 3/4/10)
-- ============================================================================
create table public.coordinator_log_subjects (
  id bigint generated always as identity primary key,
  coordinator_log_id bigint not null references public.coordinator_logs(id) on delete cascade,
  subject_id smallint not null references public.subjects(id),
  curriculum_id smallint references public.curricula(id),
  baseline_score text,
  final_outcome_grade text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (coordinator_log_id, subject_id, curriculum_id)
);

comment on table public.coordinator_log_subjects is 'One row per subject added to a Coordinator Log, with its baseline score and (once known) final-outcome grade improvement.';

create index coordinator_log_subjects_coordinator_log_id_idx on public.coordinator_log_subjects(coordinator_log_id);
create index coordinator_log_subjects_subject_id_idx on public.coordinator_log_subjects(subject_id);

alter table public.coordinator_log_subjects enable row level security;

create policy "Admins can manage all coordinator_log_subjects"
  on public.coordinator_log_subjects for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "PCs can manage coordinator_log_subjects for their assigned students"
  on public.coordinator_log_subjects for all
  to authenticated
  using (
    public.is_performance_coach() and exists (
      select 1 from public.coordinator_logs cl
      join public.pc_student_assignments a on a.student_id = cl.student_id
      where cl.id = coordinator_log_subjects.coordinator_log_id
        and a.pc_teacher_id = public.my_teacher_id()
        and a.unassigned_at is null
    )
  )
  with check (
    public.is_performance_coach() and exists (
      select 1 from public.coordinator_logs cl
      join public.pc_student_assignments a on a.student_id = cl.student_id
      where cl.id = coordinator_log_subjects.coordinator_log_id
        and a.pc_teacher_id = public.my_teacher_id()
        and a.unassigned_at is null
    )
  );

grant select, insert, update, delete on table public.coordinator_log_subjects to authenticated;
grant all on table public.coordinator_log_subjects to service_role;
grant usage on sequence public.coordinator_log_subjects_id_seq to authenticated, service_role;
