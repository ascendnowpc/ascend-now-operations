-- Coordinator Logs: automatic renewal / upsell logging.
--
-- The coordinator log's "Renewal, Upsell & Referral" section used to be filled
-- in by hand. This migration makes the Renewal Status + Upsell Opportunity +
-- Recommended Upsell + Upsell Timing fields self-maintaining: the *system*
-- files a coordinator log (attributed to the student's assigned PC, but stamped
-- primary_relationship_owner = 'ascend_now_system') the moment a package usage
-- milestone is hit or a renewal request changes state — exactly the same events
-- that already fire the 75%/100% milestone email and the renewal-request emails.
-- Referral Status is deliberately NOT automated (it's carried forward from the
-- student's previous log untouched).
--
-- Source of truth for "how full is the package" is student_packages'
-- notified_75_pct_at / notified_100_pct_at — the very columns
-- notify-package-threshold stamps when it sends the milestone email, and which
-- on_package_topup_inserted() resets to NULL on a renewal top-up. Keying off
-- them (rather than recomputing hours here) keeps this automation in lockstep
-- with the emails the coaches already receive.
--
-- Mapping (per unlocked package/pool, then aggregated to the student's single
-- renewal/upsell state):
--   Renewal Status  Not Due     — below 75%
--                   Upcoming    — 75%+ reached
--                   In Discussion — an open (pending/acknowledged) renewal request exists
--                   Renewed     — a renewal request was fulfilled and the resulting
--                                 package is still fresh (< 75% again)
--                   Not Renewing — 100% reached with no renewal in motion
--   Upsell Opp.     none (<75%) / low (75%+, no request) / medium (request sent) /
--                   high (request renewed)
--   Recommended Upsell — every package/pool at 75%+
--   Upsell Timing   — the month the earliest such package first crossed 75%
--
-- Applied live via Supabase MCP apply_migration; kept here in dependency order
-- (depends on the recommended_upsell array column from the companion
-- 20260731000000 migration).

-- ============================================================================
-- sync_coordinator_log_for_student — recompute the renewal/upsell state and, if
-- it differs from the student's latest log, append a fresh system-authored log.
-- ============================================================================
create or replace function public.sync_coordinator_log_for_student(p_student_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pc_id bigint;
  v_renewal_signal text := 'not_due';
  v_renewal_rank int := 1;
  v_upsell text := 'none';
  v_upsell_rank int := 1;
  v_recommended smallint[] := '{}';
  v_upsell_timing date;
  v_renewal_status_option_id bigint;
  v_course_type_ids smallint[];
  v_latest public.coordinator_logs%rowtype;
  v_has_latest boolean := false;
  v_new_id bigint;
  pkg record;
  v_has_open boolean;
  v_renewed_fresh boolean;
  v_sig text;
  v_rank int;
  v_up text;
  v_up_rank int;
begin
  -- The system files the log on behalf of the student's currently-assigned PC
  -- (teacher_id is NOT NULL). No active assignment → nothing to file.
  select pc_teacher_id into v_pc_id
  from public.pc_student_assignments
  where student_id = p_student_id and unassigned_at is null
  limit 1;
  if v_pc_id is null then return; end if;

  -- Per-package signal → aggregate to the strongest renewal/upsell state.
  for pkg in
    select sp.id, sp.course_type_id, sp.package_type_id,
           sp.notified_75_pct_at, sp.notified_100_pct_at
    from public.student_packages sp
    where sp.student_id = p_student_id and sp.is_locked = false
  loop
    v_has_open := exists (
      select 1 from public.package_renewal_requests r
      where r.student_id = p_student_id
        and r.course_type_id = pkg.course_type_id
        and r.status in ('pending', 'acknowledged'));

    -- "Fresh renewal": a request was fulfilled into this pool and it's since
    -- been reset below 75% (its notified_75 flag cleared by the top-up).
    v_renewed_fresh := pkg.notified_75_pct_at is null and exists (
      select 1 from public.package_renewal_requests r
      where r.status = 'renewed'
        and r.resulting_student_package_id = pkg.id);

    if v_renewed_fresh then
      v_sig := 'renewed';       v_rank := 5; v_up := 'high';   v_up_rank := 4;
    elsif v_has_open then
      v_sig := 'in_discussion'; v_rank := 4; v_up := 'medium'; v_up_rank := 3;
    elsif pkg.notified_100_pct_at is not null then
      v_sig := 'not_renewing';  v_rank := 3; v_up := 'low';    v_up_rank := 2;
    elsif pkg.notified_75_pct_at is not null then
      v_sig := 'upcoming';      v_rank := 2; v_up := 'low';    v_up_rank := 2;
    else
      v_sig := 'not_due';       v_rank := 1; v_up := 'none';   v_up_rank := 1;
    end if;

    if v_rank > v_renewal_rank then v_renewal_rank := v_rank; v_renewal_signal := v_sig; end if;
    if v_up_rank > v_upsell_rank then v_upsell_rank := v_up_rank; v_upsell := v_up; end if;
  end loop;

  -- Recommended upsell = every pool at 75%+ (bundle grouping id when the pool
  -- belongs to one, else its own course type — same "program" derivation the
  -- coordinator-log form uses). Sorted for stable equality checks.
  select coalesce(array(
    select distinct coalesce(sp.package_type_id, sp.course_type_id)::smallint
    from public.student_packages sp
    where sp.student_id = p_student_id and sp.is_locked = false
      and sp.notified_75_pct_at is not null
    order by 1
  ), '{}') into v_recommended;

  -- Upsell timing = the month the earliest 75%+ crossing happened.
  select date_trunc('month', min(sp.notified_75_pct_at))::date into v_upsell_timing
  from public.student_packages sp
  where sp.student_id = p_student_id and sp.is_locked = false
    and sp.notified_75_pct_at is not null;

  -- Resolve the renewal-status label to its admin-editable option row.
  select id into v_renewal_status_option_id
  from public.coordinator_log_options
  where list_key = 'renewal_status' and is_active
    and lower(label) = lower(case v_renewal_signal
      when 'not_due'       then 'Not Due'
      when 'upcoming'      then 'Upcoming'
      when 'in_discussion' then 'In Discussion'
      when 'renewed'       then 'Renewed'
      when 'not_renewing'  then 'Not Renewing'
    end)
  limit 1;

  -- Latest existing log → carry forward the non-automated fields.
  select * into v_latest
  from public.coordinator_logs
  where student_id = p_student_id
  order by log_date desc, id desc
  limit 1;
  v_has_latest := found;

  -- Programs this check-in covers: keep the last log's set, else derive from
  -- the student's current pools. No programs at all → nothing meaningful to log.
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

  -- No-op if the automated fields already match the latest log (avoid noise).
  if v_has_latest
     and v_latest.renewal_status_option_id is not distinct from v_renewal_status_option_id
     and v_latest.upsell_opportunity is not distinct from v_upsell
     and v_latest.upsell_timing is not distinct from v_upsell_timing
     and (select array(select unnest(coalesce(v_latest.recommended_upsell_course_type_ids, '{}')) order by 1)) = v_recommended
  then
    return;
  end if;

  insert into public.coordinator_logs (
    student_id, teacher_id, log_date, course_type_ids,
    primary_goal_option_id, goal_timeline, progress_status_option_id,
    biggest_challenge_option_id, next_action_option_id,
    final_outcome_university_placement, final_outcome_project_achievement, evidence_link_profile_building,
    student_engagement_rating, parent_engagement_rating, academic_progress_rating, referral_potential_rating,
    renewal_status_option_id, upsell_opportunity, recommended_upsell_course_type_ids, upsell_timing,
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
    v_renewal_status_option_id, v_upsell, v_recommended, v_upsell_timing,
    v_latest.referral_status_option_id, v_latest.ideal_outcome,
    v_latest.parent_involvement_rating, v_latest.transformation_outcomes_rating, v_latest.loyalty_retention_rating,
    v_latest.referral_advocacy_rating, v_latest.parent_belief_rating,
    'ascend_now_system'
  ) returning id into v_new_id;

  -- Carry the previous log's subjects + baselines forward (grade left blank —
  -- the system isn't recording a new grade, mirroring the manual form's
  -- "carry baseline, fresh grade" behaviour so it adds no grade-timeline column).
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
  'Recomputes a student''s renewal/upsell state from student_packages'' notified_75/100_pct_at flags and package_renewal_requests, and appends a system-authored coordinator log (primary_relationship_owner = ascend_now_system, attributed to the assigned PC) when it differs from their latest log. Referral Status is carried forward untouched.';

-- ============================================================================
-- Triggers — fire the sync at the same moments the coaches already get emailed.
-- ============================================================================

-- 75% / 100% milestone crossings (null -> stamped), set by notify-package-threshold.
create or replace function public.trg_coordinator_log_on_package_threshold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.notified_75_pct_at is not null and old.notified_75_pct_at is null)
     or (new.notified_100_pct_at is not null and old.notified_100_pct_at is null) then
    perform public.sync_coordinator_log_for_student(new.student_id);
  end if;
  return new;
end;
$$;

create trigger trg_sync_coordinator_log_on_threshold
  after update of notified_75_pct_at, notified_100_pct_at on public.student_packages
  for each row execute function public.trg_coordinator_log_on_package_threshold();

-- Renewal requests: a new request (→ In Discussion) or one flipped to renewed.
create or replace function public.trg_coordinator_log_on_renewal_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    perform public.sync_coordinator_log_for_student(new.student_id);
  elsif tg_op = 'UPDATE' and new.status = 'renewed' and old.status is distinct from 'renewed' then
    perform public.sync_coordinator_log_for_student(new.student_id);
  end if;
  return new;
end;
$$;

create trigger trg_sync_coordinator_log_on_renewal_request
  after insert or update on public.package_renewal_requests
  for each row execute function public.trg_coordinator_log_on_renewal_request();
