-- Coordinator Logs: remove the Upsell Opportunity signal entirely from the
-- per-package renewal automation, and repurpose Upsell Timing as Renewal
-- Timing -- the date a package's renewal became due (month it crossed 75%
-- usage), now framed purely as a renewal signal rather than an upsell one.
--
-- Also drops the three corresponding whole-log columns on coordinator_logs
-- (upsell_opportunity, recommended_upsell_course_type_ids, upsell_timing) --
-- these were already fully deprecated/dead (superseded by the per-package
-- table in 20260731000300_coordinator_log_package_statuses.sql, always
-- NULL/'{}' on every log filed since 2026-07-15 -- live-verified 0/12 rows
-- non-null/non-empty across all three) and are exactly the same "upsell"
-- concept being removed here, so there's no reason to leave them as zombie
-- columns. The frontend list view's "Upsell Opportunity" / "Recommended
-- Upsell" / "Upsell Timing" filter+columns (wired to these dead fields) are
-- removed in the same change (frontend-only, no schema impact).
--
-- Applied live via Supabase MCP apply_migration; kept here in dependency
-- order (depends on every prior coordinator_log_package_statuses migration).

-- --- 1. coordinator_log_package_status_rows(): drop upsell_opportunity from
--         the computation, rename upsell_timing -> renewal_timing. Return-
--         table shape changes, so DROP + CREATE rather than CREATE OR REPLACE
--         (same as 20260731000400_drop_coordinator_log_package_status_recommended.sql). ------
drop function if exists public.coordinator_log_package_status_rows(text);
create function public.coordinator_log_package_status_rows(p_student_id text)
returns table (
  student_package_id bigint,
  course_type_id smallint,
  package_type_id smallint,
  pool_label text,
  renewal_status text,
  renewal_timing date
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  pkg record;
  req record;
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
        and r.status in ('pending', 'acknowledged')
        and (
          (r.course_type_id = pkg.course_type_id and pkg.package_type_id is null)
          or r.course_type_id = pkg.package_type_id
        ));
    v_renewed_fresh := pkg.notified_75_pct_at is null and exists (
      select 1 from public.package_renewal_requests r
      where r.status = 'renewed'
        and r.resulting_student_package_id = pkg.id);

    student_package_id := pkg.id;
    course_type_id := pkg.course_type_id;
    package_type_id := pkg.package_type_id;
    pool_label := pkg.pool_label;
    if v_renewed_fresh then renewal_status := 'renewed';
    elsif v_has_open then renewal_status := 'in_discussion';
    elsif pkg.notified_100_pct_at is not null then renewal_status := 'not_renewing';
    elsif pkg.notified_75_pct_at is not null then renewal_status := 'upcoming';
    else renewal_status := 'not_due';
    end if;
    renewal_timing := case when pkg.notified_75_pct_at is not null then date_trunc('month', pkg.notified_75_pct_at)::date else null end;
    return next;
  end loop;

  -- Phantom rows: still-open renewal requests for a package/bundle this
  -- student doesn't have yet at all (a genuinely new-package request), so
  -- "in discussion" has somewhere to show up even before any real package
  -- row exists to hang it off of.
  for req in
    select distinct r.course_type_id
    from public.package_renewal_requests r
    where r.student_id = p_student_id
      and r.status in ('pending', 'acknowledged')
      and not exists (
        select 1 from public.student_packages sp
        where sp.student_id = p_student_id and sp.is_locked = false
          and (
            (sp.course_type_id = r.course_type_id and sp.package_type_id is null)
            or sp.package_type_id = r.course_type_id
          )
      )
  loop
    student_package_id := null;
    course_type_id := req.course_type_id;
    package_type_id := null;
    pool_label := null;
    renewal_status := 'in_discussion';
    renewal_timing := null;
    return next;
  end loop;
end;
$$;

comment on function public.coordinator_log_package_status_rows(text) is
  'Returns the current per-package renewal status set for a student (including phantom rows for still-open renewal requests with no matching package yet). renewal_timing is the month the package crossed 75% usage (non-null <=> at 75%+ usage) -- formerly upsell_timing.';

-- --- 2. coordinator_log_package_statuses: drop upsell_opportunity, rename
--         upsell_timing -> renewal_timing. -----------------------------------
alter table public.coordinator_log_package_statuses
  drop column upsell_opportunity;
alter table public.coordinator_log_package_statuses
  rename column upsell_timing to renewal_timing;

comment on column public.coordinator_log_package_statuses.renewal_timing is
  'Month this package/pool crossed 75% usage (non-null <=> at 75%+ usage) -- the timing for that package''s renewal. Renamed from upsell_timing 2026-07-16.';

comment on table public.coordinator_log_package_statuses is
  'One row per package/pool, snapshotting that package''s renewal status as of its parent coordinator_logs row. Populated automatically at log-insert time (trg_coordinator_logs_snapshot_statuses) from the live package state -- never entered by a PC/admin. A coordinator log''s renewal "section" is this set of rows.';

-- --- 3. Snapshot trigger fn: stop inserting upsell_opportunity, rename
--         upsell_timing -> renewal_timing. -----------------------------------
create or replace function public.trg_snapshot_coordinator_log_package_statuses()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.coordinator_log_package_statuses (
    coordinator_log_id, student_package_id, course_type_id, package_type_id, pool_label,
    renewal_status, renewal_timing, sort_order
  )
  select new.id, r.student_package_id, r.course_type_id, r.package_type_id, r.pool_label,
         r.renewal_status, r.renewal_timing,
         (row_number() over (order by r.student_package_id))::int
  from public.coordinator_log_package_status_rows(new.student_id) r;
  return new;
end;
$$;

-- --- 4. Change-detection signature: drop upsell_opportunity, rename
--         upsell_timing -> renewal_timing on both sides. ---------------------
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
  select pc_teacher_id into v_pc_id
  from public.pc_student_assignments
  where student_id = p_student_id and unassigned_at is null
  limit 1;
  if v_pc_id is null then return; end if;

  select count(*) into v_pkg_count
  from public.student_packages where student_id = p_student_id and is_locked = false;
  if v_pkg_count = 0 then return; end if;

  select coalesce(string_agg(sig, '|' order by sig), '') into v_new_sig from (
    select coalesce(student_package_id::text, 'new:' || course_type_id::text) || ':' || renewal_status
           || ':' || coalesce(renewal_timing::text, '') as sig
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
      select coalesce(student_package_id::text, 'new:' || course_type_id::text) || ':' || renewal_status
             || ':' || coalesce(renewal_timing::text, '') as sig
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
    coalesce(v_latest.primary_relationship_owner, 'pc_cc')
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
  'Appends a new coordinator log (today''s date, latest carried forward, primary_relationship_owner carried forward defaulting to pc_cc, on the assigned PC''s behalf) when a student''s per-package renewal section changes vs. their latest log. No-op when unchanged; skipped when the student has no active PC or no packages. The new log''s per-package status is snapshotted by trg_coordinator_logs_snapshot_statuses.';

-- --- 5. coordinator_logs: drop the deprecated whole-log upsell columns
--         (superseded by the per-package table since 20260731000300; live-
--         verified 0/12 rows have any non-null/non-empty value in any of the
--         three). Fix the month-dates CHECK first since it references
--         upsell_timing alongside goal_timeline. ------------------------------
alter table public.coordinator_logs
  drop constraint coordinator_logs_month_dates_check;
alter table public.coordinator_logs
  add constraint coordinator_logs_month_dates_check check (
    goal_timeline is null or extract(day from goal_timeline) = 1
  );

alter table public.coordinator_logs
  drop column upsell_opportunity,
  drop column recommended_upsell_course_type_ids,
  drop column upsell_timing;

comment on table public.coordinator_logs is
  'Periodic PC coaching check-in per student: goals, progress, final outcomes, ratings, renewal/referral signals. Repeating history, one row per check-in.';
