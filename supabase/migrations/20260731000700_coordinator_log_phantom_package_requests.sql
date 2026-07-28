-- Coordinator Logs: a still-open renewal request for a package the student
-- doesn't have yet must still show as "In Discussion".
--
-- coordinator_log_package_status_rows() only ever emitted a row per existing
-- (unlocked) student_packages row, matching package_renewal_requests onto it.
-- A PC can file a renewal request for a course type the student has never
-- had — a genuinely new package/upsell, not a top-up of something existing
-- (e.g. requesting standalone "Beyond Academic" for a student whose only
-- Beyond Academic pools live inside their All-In-One bundle, or requesting a
-- bundle the student doesn't own at all yet). With no student_packages row to
-- attach a status to, that request silently never appeared anywhere in the
-- coordinator log — not "in_discussion", not anything (this is exactly what
-- happened for S1's standalone Beyond Academic / College Counselling
-- requests, filed while both course types only exist inside her All-In-One
-- bundle).
--
-- Fix: emit one extra "phantom" row (student_package_id = null) per distinct
-- course_type_id among the student's still-open (pending/acknowledged)
-- renewal requests that don't match any of their current unlocked packages
-- (same match rule as the real-package branch: same leaf course type
-- standalone, or the bundle those pools are grouped under) — always
-- 'in_discussion' / 'medium', since a request only exists while it's open.
--
-- sync_coordinator_log_for_student()'s change-detection signature is fixed to
-- key phantom rows by course_type_id (student_package_id is null there, and
-- `null || ...` collapses the whole concatenation to null, which string_agg
-- then silently drops — phantom-row changes would never trigger a new log).
--
-- Applied live via Supabase MCP apply_migration; kept here in dependency order.

create or replace function public.coordinator_log_package_status_rows(p_student_id text)
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
    if v_renewed_fresh then renewal_status := 'renewed'; upsell_opportunity := 'high';
    elsif v_has_open then renewal_status := 'in_discussion'; upsell_opportunity := 'medium';
    elsif pkg.notified_100_pct_at is not null then renewal_status := 'not_renewing'; upsell_opportunity := 'low';
    elsif pkg.notified_75_pct_at is not null then renewal_status := 'upcoming'; upsell_opportunity := 'low';
    else renewal_status := 'not_due'; upsell_opportunity := 'none';
    end if;
    upsell_timing := case when pkg.notified_75_pct_at is not null then date_trunc('month', pkg.notified_75_pct_at)::date else null end;
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
    upsell_opportunity := 'medium';
    upsell_timing := null;
    return next;
  end loop;
end;
$$;

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
    select coalesce(student_package_id::text, 'new:' || course_type_id::text) || ':' || renewal_status || ':' || upsell_opportunity
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
      select coalesce(student_package_id::text, 'new:' || course_type_id::text) || ':' || renewal_status || ':' || upsell_opportunity
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

-- Backfill: file a fresh status log for every student whose phantom-row
-- signature now differs from their latest logged snapshot (e.g. S1's
-- standalone Beyond Academic / College Counselling renewal requests,
-- previously invisible).
do $$
declare s record;
begin
  for s in select id from public.students loop
    perform public.sync_coordinator_log_for_student(s.id);
  end loop;
end;
$$;
