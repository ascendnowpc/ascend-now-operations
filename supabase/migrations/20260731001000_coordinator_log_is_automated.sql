-- Distinguish coordinator logs the automation files by itself (the per-package
-- renewal sync) from ones a Performance Coach actually filed by hand. This lets
-- the app surface "the first date a PC logged this student" while excluding the
-- automatic snapshots — see sync_coordinator_log_for_student below, which now
-- stamps is_automated = true on every row it inserts.
alter table public.coordinator_logs
  add column if not exists is_automated boolean not null default false;

comment on column public.coordinator_logs.is_automated is
  'true when the row was filed automatically by sync_coordinator_log_for_student (per-package renewal automation / initial backfill); false for a log a PC or admin filed via the form. Used to derive the first *manual* PC log date per student.';

-- Best-effort backfill of existing rows: an automatic renewal/backfill snapshot
-- carries no hand-entered content (it only mirrors the previous log's fields,
-- and the earliest one has none), so any log with every manual field null and no
-- subject baseline/grade is treated as automatic; anything with a manual field
-- set was filed by a PC. (Going forward the function below sets the flag
-- explicitly, so this heuristic only ever runs against today's rows.)
update public.coordinator_logs cl set is_automated = true
where cl.primary_goal_option_id is null
  and cl.progress_status_option_id is null
  and cl.biggest_challenge_option_id is null
  and cl.next_action_option_id is null
  and cl.goal_timeline is null
  and cl.final_outcome_university_placement is null
  and cl.final_outcome_project_achievement is null
  and cl.evidence_link_profile_building is null
  and cl.ideal_outcome is null
  and cl.referral_status_option_id is null
  and cl.student_engagement_rating is null
  and cl.parent_engagement_rating is null
  and cl.academic_progress_rating is null
  and cl.referral_potential_rating is null
  and cl.parent_involvement_rating is null
  and cl.transformation_outcomes_rating is null
  and cl.loyalty_retention_rating is null
  and cl.referral_advocacy_rating is null
  and cl.parent_belief_rating is null
  and not exists (
    select 1 from public.coordinator_log_subjects s
    where s.coordinator_log_id = cl.id
      and (s.baseline_score is not null or s.final_outcome_grade is not null)
  );

-- Redefine the auto-file function to (1) stamp is_automated = true on the log it
-- inserts and (2) carry the new baseline_score_date forward when copying the
-- previous log's subjects (same as baseline_score already is).
create or replace function public.sync_coordinator_log_for_student(p_student_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    primary_relationship_owner, is_automated
  ) values (
    p_student_id, v_pc_id, current_date, v_course_type_ids,
    v_latest.primary_goal_option_id, v_latest.goal_timeline, v_latest.progress_status_option_id,
    v_latest.biggest_challenge_option_id, v_latest.next_action_option_id,
    v_latest.final_outcome_university_placement, v_latest.final_outcome_project_achievement, v_latest.evidence_link_profile_building,
    v_latest.student_engagement_rating, v_latest.parent_engagement_rating, v_latest.academic_progress_rating, v_latest.referral_potential_rating,
    v_latest.referral_status_option_id, v_latest.ideal_outcome,
    v_latest.parent_involvement_rating, v_latest.transformation_outcomes_rating, v_latest.loyalty_retention_rating,
    v_latest.referral_advocacy_rating, v_latest.parent_belief_rating,
    coalesce(v_latest.primary_relationship_owner, 'pc_cc'), true
  ) returning id into v_new_id;

  if v_has_latest then
    insert into public.coordinator_log_subjects
      (coordinator_log_id, subject_id, curriculum_id, baseline_score, baseline_score_date, final_outcome_grade, sort_order)
    select v_new_id, subject_id, curriculum_id, baseline_score, baseline_score_date, null, sort_order
    from public.coordinator_log_subjects
    where coordinator_log_id = v_latest.id;
  end if;
end;
$function$;
