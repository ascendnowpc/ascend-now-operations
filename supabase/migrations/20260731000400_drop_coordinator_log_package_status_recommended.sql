-- Coordinator Logs: drop the per-package `recommended` upsell flag.
--
-- coordinator_log_package_statuses.recommended was a boolean meaning "this
-- package is at 75%+ usage (an upsell candidate)". It was derived as exactly
-- `notified_75_pct_at is not null` — which is also precisely when upsell_timing
-- is non-null — so the "Recommended" column carried zero information beyond
-- "Upsell Timing has a date", and each row is already one package. Removed
-- end-to-end: the column, its computation in coordinator_log_package_status_rows,
-- the snapshot insert, and the change-detection signature (upsell_timing still
-- captures the same 75% crossing, so dedup sensitivity is unchanged).
--
-- Applied live via Supabase MCP apply_migration; kept here in dependency order.

-- --- 1. Recompute rows without `recommended` (return-table shape changes, so
--         DROP + CREATE rather than CREATE OR REPLACE). -----------------------
drop function if exists public.coordinator_log_package_status_rows(text);
create function public.coordinator_log_package_status_rows(p_student_id text)
returns table (
  student_package_id bigint,
  course_type_id smallint,
  package_type_id smallint,
  pool_label text,
  renewal_status text,
  upsell_opportunity text,
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
    upsell_timing := case when pkg.notified_75_pct_at is not null then date_trunc('month', pkg.notified_75_pct_at)::date else null end;
    return next;
  end loop;
end;
$$;

-- --- 2. Snapshot trigger fn: stop inserting `recommended`. -------------------
create or replace function public.trg_snapshot_coordinator_log_package_statuses()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.coordinator_log_package_statuses (
    coordinator_log_id, student_package_id, course_type_id, package_type_id, pool_label,
    renewal_status, upsell_opportunity, upsell_timing, sort_order
  )
  select new.id, r.student_package_id, r.course_type_id, r.package_type_id, r.pool_label,
         r.renewal_status, r.upsell_opportunity, r.upsell_timing,
         (row_number() over (order by r.student_package_id))::int
  from public.coordinator_log_package_status_rows(new.student_id) r;
  return new;
end;
$$;

-- --- 3. Change-detection signature: drop `recommended` from both sides. ------
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
    select student_package_id || ':' || renewal_status || ':' || upsell_opportunity
           || ':' || coalesce(upsell_timing::text, '') as sig
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
             || ':' || coalesce(upsell_timing::text, '') as sig
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

-- --- 4. Drop the column now that nothing writes or reads it. -----------------
alter table public.coordinator_log_package_statuses drop column recommended;
