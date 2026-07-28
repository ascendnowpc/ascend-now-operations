-- Coordinator Logs: per-package renewal/upsell status, auto-appended to the log.
--
-- Final shape of the renewal/upsell automation. Instead of a separate status
-- table, the renewal/upsell "section" of a coordinator log is a set of
-- per-package child rows (coordinator_log_package_statuses) on each
-- coordinator_logs row. When any package's derived status changes, the system
-- files a **new coordinator log** (exactly like a PC filing an update — today's
-- date, everything else carried forward from the latest log, attributed to the
-- assigned PC and stamped primary_relationship_owner = 'ascend_now_system'),
-- and that new log snapshots the current per-package statuses. So the
-- coordinator-log history itself is the dated record of "on this date, this
-- package's renewal status changed to X". Nothing in this section is entered by
-- a PC/admin (removed from the form); Referral Status stays manual.
--
-- Replaces the short-lived package_renewal_status_events table from
-- 20260731000200 (which kept the history in its own table rather than as
-- coordinator-log entries) and the aggregate whole-log automation from
-- 20260731000100.
--
-- Applied live via Supabase MCP apply_migration; kept here in dependency order.

-- --- 1. Drop the standalone events table + its automation --------------------
drop trigger if exists trg_prs_student_packages_ins on public.student_packages;
drop trigger if exists trg_prs_student_packages_upd on public.student_packages;
drop trigger if exists trg_prs_renewal_requests on public.package_renewal_requests;
drop function if exists public.trg_record_package_renewal_status_pkg();
drop function if exists public.trg_record_package_renewal_status_req();
drop function if exists public.record_package_renewal_status(text);
drop table if exists public.package_renewal_status_events;

-- --- 2. Per-package status child table (one set per coordinator log) ---------
create table public.coordinator_log_package_statuses (
  id bigint generated always as identity primary key,
  coordinator_log_id bigint not null references public.coordinator_logs(id) on delete cascade,
  student_package_id bigint references public.student_packages(id) on delete set null,
  course_type_id smallint references public.course_types(id),
  package_type_id smallint references public.course_types(id),
  pool_label text,
  renewal_status text not null check (renewal_status in ('not_due','upcoming','in_discussion','renewed','not_renewing')),
  upsell_opportunity text not null check (upsell_opportunity in ('none','low','medium','high')),
  recommended boolean not null default false,
  upsell_timing date,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.coordinator_log_package_statuses is
  'One row per package/pool, snapshotting that package''s renewal/upsell status as of its parent coordinator_logs row. Populated automatically at log-insert time (trg_coordinator_logs_snapshot_statuses) from the live package state — never entered by a PC/admin. A coordinator log''s renewal/upsell "section" is this set of rows.';

create index coordinator_log_package_statuses_log_id_idx on public.coordinator_log_package_statuses(coordinator_log_id);

alter table public.coordinator_log_package_statuses enable row level security;

-- Same access model as coordinator_log_subjects (no student_id of its own).
create policy "Admins can manage all coordinator_log_package_statuses"
  on public.coordinator_log_package_statuses for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "PCs can read coordinator_log_package_statuses for their students"
  on public.coordinator_log_package_statuses for select
  to authenticated
  using (
    public.is_performance_coach() and exists (
      select 1 from public.coordinator_logs cl
      join public.pc_student_assignments a on a.student_id = cl.student_id
      where cl.id = coordinator_log_package_statuses.coordinator_log_id
        and a.pc_teacher_id = public.my_teacher_id()
        and a.unassigned_at is null
    )
  );

grant select on table public.coordinator_log_package_statuses to authenticated;
grant all on table public.coordinator_log_package_statuses to service_role;

-- --- 3. Per-package status computation (shared by snapshot + change check) ---
create or replace function public.coordinator_log_package_status_rows(p_student_id text)
returns table (
  student_package_id bigint,
  course_type_id smallint,
  package_type_id smallint,
  pool_label text,
  renewal_status text,
  upsell_opportunity text,
  recommended boolean,
  upsell_timing date
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  pkg record;
  v_has_open boolean;
  v_renewed_fresh boolean;
begin
  for pkg in
    select sp.id, sp.course_type_id, sp.package_type_id, sp.pool_label,
           sp.notified_75_pct_at, sp.notified_100_pct_at
    from public.student_packages sp
    where sp.student_id = p_student_id and sp.is_locked = false
  loop
    v_has_open := exists (
      select 1 from public.package_renewal_requests r
      where r.student_id = p_student_id
        and r.course_type_id = pkg.course_type_id
        and r.status in ('pending', 'acknowledged'));
    v_renewed_fresh := pkg.notified_75_pct_at is null and exists (
      select 1 from public.package_renewal_requests r
      where r.status = 'renewed'
        and r.resulting_student_package_id = pkg.id);

    student_package_id := pkg.id;
    course_type_id := pkg.course_type_id;
    package_type_id := pkg.package_type_id;
    pool_label := pkg.pool_label;
    if v_renewed_fresh then renewal_status := 'renewed'; upsell_opportunity := 'high';
    elsif v_has_open then renewal_status := 'in_discussion'; upsell_opportunity := 'medium';
    elsif pkg.notified_100_pct_at is not null then renewal_status := 'not_renewing'; upsell_opportunity := 'low';
    elsif pkg.notified_75_pct_at is not null then renewal_status := 'upcoming'; upsell_opportunity := 'low';
    else renewal_status := 'not_due'; upsell_opportunity := 'none';
    end if;
    recommended := pkg.notified_75_pct_at is not null;
    upsell_timing := case when recommended then date_trunc('month', pkg.notified_75_pct_at)::date else null end;
    return next;
  end loop;
end;
$$;

-- --- 4. Snapshot the section onto every coordinator log at insert time -------
-- Fires for BOTH manual (PC) and automatic logs, so any coordinator log carries
-- the per-package status as of its own date.
create or replace function public.trg_snapshot_coordinator_log_package_statuses()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.coordinator_log_package_statuses (
    coordinator_log_id, student_package_id, course_type_id, package_type_id, pool_label,
    renewal_status, upsell_opportunity, recommended, upsell_timing, sort_order
  )
  select new.id, r.student_package_id, r.course_type_id, r.package_type_id, r.pool_label,
         r.renewal_status, r.upsell_opportunity, r.recommended, r.upsell_timing,
         (row_number() over (order by r.student_package_id))::int
  from public.coordinator_log_package_status_rows(new.student_id) r;
  return new;
end;
$$;

create trigger trg_coordinator_logs_snapshot_statuses
  after insert on public.coordinator_logs
  for each row execute function public.trg_snapshot_coordinator_log_package_statuses();

-- --- 5. Append a new coordinator log when the section changes ----------------
create or replace function public.sync_coordinator_log_for_student(p_student_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pc_id bigint;
  v_pkg_count int;
  v_new_sig text;
  v_old_sig text;
  v_latest public.coordinator_logs%rowtype;
  v_has_latest boolean := false;
  v_course_type_ids smallint[];
  v_new_id bigint;
begin
  -- Filed on behalf of the assigned PC (teacher_id is NOT NULL); no PC → skip.
  select pc_teacher_id into v_pc_id
  from public.pc_student_assignments
  where student_id = p_student_id and unassigned_at is null
  limit 1;
  if v_pc_id is null then return; end if;

  select count(*) into v_pkg_count
  from public.student_packages where student_id = p_student_id and is_locked = false;
  if v_pkg_count = 0 then return; end if;

  -- Signature of the current per-package section.
  select coalesce(string_agg(sig, '|' order by sig), '') into v_new_sig from (
    select student_package_id || ':' || renewal_status || ':' || upsell_opportunity
           || ':' || recommended || ':' || coalesce(upsell_timing::text, '') as sig
    from public.coordinator_log_package_status_rows(p_student_id)
  ) t;

  select * into v_latest
  from public.coordinator_logs
  where student_id = p_student_id
  order by log_date desc, id desc
  limit 1;
  v_has_latest := found;

  if v_has_latest then
    select coalesce(string_agg(sig, '|' order by sig), '') into v_old_sig from (
      select student_package_id || ':' || renewal_status || ':' || upsell_opportunity
             || ':' || recommended || ':' || coalesce(upsell_timing::text, '') as sig
      from public.coordinator_log_package_statuses
      where coordinator_log_id = v_latest.id
    ) t;
    if v_new_sig = v_old_sig then return; end if;
  end if;

  if v_has_latest and array_length(v_latest.course_type_ids, 1) is not null then
    v_course_type_ids := v_latest.course_type_ids;
  else
    select coalesce(array(
      select distinct coalesce(sp.package_type_id, sp.course_type_id)::smallint
      from public.student_packages sp
      where sp.student_id = p_student_id and sp.is_locked = false
      order by 1
    ), '{}') into v_course_type_ids;
  end if;
  if array_length(v_course_type_ids, 1) is null then return; end if;

  -- New log = latest carried forward, today's date, system-owned. The renewal/
  -- upsell "section" (child rows) is filled by the AFTER INSERT snapshot trigger.
  insert into public.coordinator_logs (
    student_id, teacher_id, log_date, course_type_ids,
    primary_goal_option_id, goal_timeline, progress_status_option_id,
    biggest_challenge_option_id, next_action_option_id,
    final_outcome_university_placement, final_outcome_project_achievement, evidence_link_profile_building,
    student_engagement_rating, parent_engagement_rating, academic_progress_rating, referral_potential_rating,
    referral_status_option_id, ideal_outcome,
    parent_involvement_rating, transformation_outcomes_rating, loyalty_retention_rating,
    referral_advocacy_rating, parent_belief_rating,
    primary_relationship_owner
  ) values (
    p_student_id, v_pc_id, current_date, v_course_type_ids,
    v_latest.primary_goal_option_id, v_latest.goal_timeline, v_latest.progress_status_option_id,
    v_latest.biggest_challenge_option_id, v_latest.next_action_option_id,
    v_latest.final_outcome_university_placement, v_latest.final_outcome_project_achievement, v_latest.evidence_link_profile_building,
    v_latest.student_engagement_rating, v_latest.parent_engagement_rating, v_latest.academic_progress_rating, v_latest.referral_potential_rating,
    v_latest.referral_status_option_id, v_latest.ideal_outcome,
    v_latest.parent_involvement_rating, v_latest.transformation_outcomes_rating, v_latest.loyalty_retention_rating,
    v_latest.referral_advocacy_rating, v_latest.parent_belief_rating,
    'ascend_now_system'
  ) returning id into v_new_id;

  if v_has_latest then
    insert into public.coordinator_log_subjects
      (coordinator_log_id, subject_id, curriculum_id, baseline_score, final_outcome_grade, sort_order)
    select v_new_id, subject_id, curriculum_id, baseline_score, null, sort_order
    from public.coordinator_log_subjects
    where coordinator_log_id = v_latest.id;
  end if;
end;
$$;

comment on function public.sync_coordinator_log_for_student(text) is
  'Appends a new coordinator log (today''s date, latest carried forward, primary_relationship_owner = ascend_now_system, on the assigned PC''s behalf) when a student''s per-package renewal/upsell section changes vs. their latest log. No-op when unchanged; skipped when the student has no active PC or no packages. The new log''s per-package status is snapshotted by trg_coordinator_logs_snapshot_statuses.';

-- --- 6. Fire the sync at the same moments the coaches are emailed ------------
create or replace function public.trg_sync_coordinator_log_pkg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.sync_coordinator_log_for_student(new.student_id);
  return new;
end;
$$;

create trigger trg_sync_coordinator_log_sp_ins
  after insert on public.student_packages
  for each row execute function public.trg_sync_coordinator_log_pkg();

create trigger trg_sync_coordinator_log_sp_upd
  after update of notified_75_pct_at, notified_100_pct_at on public.student_packages
  for each row execute function public.trg_sync_coordinator_log_pkg();

create or replace function public.trg_sync_coordinator_log_req()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.sync_coordinator_log_for_student(new.student_id);
  return new;
end;
$$;

create trigger trg_sync_coordinator_log_req
  after insert or update on public.package_renewal_requests
  for each row execute function public.trg_sync_coordinator_log_req();

-- --- 7. Backfill: file a current status log for every student ----------------
do $$
declare s record;
begin
  for s in select id from public.students loop
    perform public.sync_coordinator_log_for_student(s.id);
  end loop;
end;
$$;
