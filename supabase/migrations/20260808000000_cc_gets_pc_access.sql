-- College Counsellors get the same access a Performance Coach has.
--
-- Until now a CC was a deliberately narrow role: their own session logs, their
-- own roster, nothing else. The product decision has changed — a CC is now a
-- peer of the PC and can do everything a coach can, including filing package
-- renewal requests for their assigned students.
--
-- Rather than adding a second, near-identical policy next to every
-- `is_performance_coach()` one, each of those policies is rewritten in place
-- (same policy name, so anything referring to them by name still lines up) to
-- use two new helpers:
--
--   is_coach_or_counselor()      — the PC-or-CC role test
--   is_my_assigned_student(id)   — "this student is on my live roster",
--                                  looking at BOTH pc_student_assignments and
--                                  cc_student_assignments
--
-- The second one is what actually makes a CC's access useful: the assignment-
-- scoped PC policies all joined `pc_student_assignments` directly, so a CC
-- (who has no rows there) would have matched nothing even with the role test
-- widened.
--
-- Note this reverses 20260806000200_cc_reads_only_own_session_logs.sql, which
-- narrowed a counsellor to their own session logs. A counsellor now reads
-- session logs the same way a coach does.

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.is_coach_or_counselor()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_performance_coach() or public.is_college_counselor();
$$;

comment on function public.is_coach_or_counselor() is
  'True for a Performance Coach or a College Counsellor. The two roles now carry the same access; see 20260808000000.';

create or replace function public.is_my_assigned_student(p_student_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.pc_student_assignments a
    where a.student_id = p_student_id
      and a.unassigned_at is null
      and a.pc_teacher_id = public.my_teacher_id()
  ) or exists (
    select 1 from public.cc_student_assignments a
    where a.student_id = p_student_id
      and a.unassigned_at is null
      and a.cc_teacher_id = public.my_teacher_id()
  );
$$;

comment on function public.is_my_assigned_student(text) is
  'True when the caller is the student''s currently-assigned Performance Coach or College Counsellor. Someone who is both matches on either roster.';

grant execute on function public.is_coach_or_counselor() to authenticated, service_role;
grant execute on function public.is_my_assigned_student(text) to authenticated, service_role;

-- ── Blanket role-gated policies ──────────────────────────────────────────────

drop policy "Performance coaches can read all content_uploads" on public.content_uploads;
create policy "Performance coaches can read all content_uploads"
  on public.content_uploads for select
  using (public.is_coach_or_counselor());

drop policy "PCs can read active coordinator_log_options" on public.coordinator_log_options;
create policy "PCs can read active coordinator_log_options"
  on public.coordinator_log_options for select
  using (is_active and public.is_coach_or_counselor());

drop policy "Performance coaches can insert curricula" on public.curricula;
create policy "Performance coaches can insert curricula"
  on public.curricula for insert
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can update curricula" on public.curricula;
create policy "Performance coaches can update curricula"
  on public.curricula for update
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can manage curriculum_groups" on public.curriculum_groups;
create policy "Performance coaches can manage curriculum_groups"
  on public.curriculum_groups for all
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can manage all generated_papers" on public.generated_papers;
create policy "Performance coaches can manage all generated_papers"
  on public.generated_papers for all
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can manage all grades" on public.grades;
create policy "Performance coaches can manage all grades"
  on public.grades for all
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can read all session_insights" on public.session_insights;
create policy "Performance coaches can read all session_insights"
  on public.session_insights for select
  using (public.is_coach_or_counselor());

drop policy "Performance coaches can read all submissions" on public.submissions;
create policy "Performance coaches can read all submissions"
  on public.submissions for select
  using (public.is_coach_or_counselor());

drop policy "Performance coaches can manage all subject_notes" on public.subject_notes;
create policy "Performance coaches can manage all subject_notes"
  on public.subject_notes for all
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can insert subject_categories" on public.subject_categories;
create policy "Performance coaches can insert subject_categories"
  on public.subject_categories for insert
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can manage subject_categories" on public.subject_categories;
create policy "Performance coaches can manage subject_categories"
  on public.subject_categories for all
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can update subject_categories" on public.subject_categories;
create policy "Performance coaches can update subject_categories"
  on public.subject_categories for update
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can insert subjects" on public.subjects;
create policy "Performance coaches can insert subjects"
  on public.subjects for insert
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can manage subjects" on public.subjects;
create policy "Performance coaches can manage subjects"
  on public.subjects for all
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can update subjects" on public.subjects;
create policy "Performance coaches can update subjects"
  on public.subjects for update
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "Performance coaches can read users" on public.users;
create policy "Performance coaches can read users"
  on public.users for select
  using (public.is_coach_or_counselor());

-- Session logs: a counsellor now reads and edits them exactly as a coach does.
drop policy "Performance coaches can read all session_logs" on public.session_logs;
create policy "Performance coaches can read all session_logs"
  on public.session_logs for select
  using (public.is_coach_or_counselor());

drop policy "Performance coaches can update session_logs" on public.session_logs;
create policy "Performance coaches can update session_logs"
  on public.session_logs for update
  using (public.is_coach_or_counselor())
  with check (public.is_coach_or_counselor());

drop policy "PCs can read sessions for assigned students" on public.session_logs;
create policy "PCs can read sessions for assigned students"
  on public.session_logs for select
  using (public.is_coach_or_counselor() and public.is_my_assigned_student(student_id));

-- ── Roster-scoped policies ───────────────────────────────────────────────────

drop policy "PCs can manage coordinator_logs for their assigned students" on public.coordinator_logs;
create policy "PCs can manage coordinator_logs for their assigned students"
  on public.coordinator_logs for all to authenticated
  using (public.is_coach_or_counselor() and public.is_my_assigned_student(student_id))
  with check (public.is_coach_or_counselor() and public.is_my_assigned_student(student_id));

drop policy "PCs can manage coordinator_log_subjects for their assigned stud" on public.coordinator_log_subjects;
create policy "PCs can manage coordinator_log_subjects for their assigned stud"
  on public.coordinator_log_subjects for all
  using (
    public.is_coach_or_counselor()
    and exists (
      select 1 from public.coordinator_logs cl
      where cl.id = coordinator_log_subjects.coordinator_log_id
        and public.is_my_assigned_student(cl.student_id)
    )
  )
  with check (
    public.is_coach_or_counselor()
    and exists (
      select 1 from public.coordinator_logs cl
      where cl.id = coordinator_log_subjects.coordinator_log_id
        and public.is_my_assigned_student(cl.student_id)
    )
  );

drop policy "PCs can read coordinator_log_package_statuses for their student" on public.coordinator_log_package_statuses;
create policy "PCs can read coordinator_log_package_statuses for their student"
  on public.coordinator_log_package_statuses for select
  using (
    public.is_coach_or_counselor()
    and exists (
      select 1 from public.coordinator_logs cl
      where cl.id = coordinator_log_package_statuses.coordinator_log_id
        and public.is_my_assigned_student(cl.student_id)
    )
  );

drop policy "PCs can submit renewal requests for their assigned students" on public.package_renewal_requests;
create policy "PCs can submit renewal requests for their assigned students"
  on public.package_renewal_requests for insert to authenticated
  with check (
    public.is_coach_or_counselor()
    and requested_by_teacher_id = public.my_teacher_id()
    and public.is_my_assigned_student(student_id)
  );

drop policy "PCs can view their own renewal requests" on public.package_renewal_requests;
create policy "PCs can view their own renewal requests"
  on public.package_renewal_requests for select to authenticated
  using (public.is_coach_or_counselor() and requested_by_teacher_id = public.my_teacher_id());

drop policy "pc_manage_assigned_invoices" on public.invoices;
create policy "pc_manage_assigned_invoices"
  on public.invoices for all
  using (public.is_coach_or_counselor() and public.is_my_assigned_student(student_id))
  with check (public.is_coach_or_counselor() and public.is_my_assigned_student(student_id));

drop policy "pc_manage_line_items" on public.invoice_line_items;
create policy "pc_manage_line_items"
  on public.invoice_line_items for all
  using (
    public.is_coach_or_counselor()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and public.is_my_assigned_student(i.student_id)
    )
  )
  with check (
    public.is_coach_or_counselor()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and public.is_my_assigned_student(i.student_id)
    )
  );

drop policy "pc_manage_invoice_packages" on public.invoice_packages;
create policy "pc_manage_invoice_packages"
  on public.invoice_packages for all
  using (
    public.is_coach_or_counselor()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_packages.invoice_id
        and public.is_my_assigned_student(i.student_id)
    )
  )
  with check (
    public.is_coach_or_counselor()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_packages.invoice_id
        and public.is_my_assigned_student(i.student_id)
    )
  );

drop policy "pc_manage_assigned_packages" on public.student_packages;
create policy "pc_manage_assigned_packages"
  on public.student_packages for all
  using (public.is_coach_or_counselor() and public.is_my_assigned_student(student_id))
  with check (public.is_coach_or_counselor() and public.is_my_assigned_student(student_id));

drop policy "pc_insert_own_topups" on public.package_topups;
create policy "pc_insert_own_topups"
  on public.package_topups for insert
  with check (
    public.is_coach_or_counselor()
    and exists (
      select 1 from public.student_packages sp
      where sp.id = package_topups.student_package_id
        and public.is_my_assigned_student(sp.student_id)
    )
  );

drop policy "pc_select_own_topups" on public.package_topups;
create policy "pc_select_own_topups"
  on public.package_topups for select
  using (
    public.is_coach_or_counselor()
    and exists (
      select 1 from public.student_packages sp
      where sp.id = package_topups.student_package_id
        and public.is_my_assigned_student(sp.student_id)
    )
  );

drop policy "pc_manage_assigned_session_log_pool_resolutions" on public.session_log_pool_resolutions;
create policy "pc_manage_assigned_session_log_pool_resolutions"
  on public.session_log_pool_resolutions for all
  using (public.is_coach_or_counselor() and public.is_my_assigned_student(student_id))
  with check (public.is_coach_or_counselor() and public.is_my_assigned_student(student_id));

-- ── A student sees their counsellor's profile card too ───────────────────────
--
-- pc_profiles is the one profile table; a counsellor's card is a row in it
-- keyed by their teacher_id, written by an admin from /admin/ccs/:id the same
-- way a coach's is written from /admin/pcs/:id. This is the CC twin of
-- "Students read their assigned coach pc_profile".

create policy "Students read their assigned counsellor pc_profile"
  on public.pc_profiles for select to authenticated
  using (
    exists (
      select 1
      from public.cc_student_assignments a
      join public.students s on s.id = a.student_id
      where a.cc_teacher_id = pc_profiles.teacher_id
        and a.unassigned_at is null
        and s.user_id = (select auth.uid())
    )
  );

-- ── set_student_status: a counsellor may move their own student too ──────────

create or replace function public.set_student_status(p_student_id text, p_status text)
returns public.students
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_student public.students;
begin
  if p_status not in ('active', 'paused', 'completed') then
    raise exception 'Invalid student status: %', p_status
      using errcode = 'check_violation';
  end if;

  if not (
    public.is_admin()
    or (public.is_coach_or_counselor() and public.is_my_assigned_student(p_student_id))
  ) then
    raise exception 'Not allowed to change the status of student %', p_student_id
      using errcode = 'insufficient_privilege';
  end if;

  update public.students
     set status = p_status,
         status_changed_at = now()
   where id = p_student_id
  returning * into v_student;

  if v_student.id is null then
    raise exception 'Student % not found', p_student_id using errcode = 'no_data_found';
  end if;

  if p_status = 'completed' then
    update public.pc_student_assignments
       set unassigned_at = now()
     where student_id = p_student_id
       and unassigned_at is null;

    update public.cc_student_assignments
       set status = 'completed',
           unassigned_at = now(),
           status_changed_at = now()
     where student_id = p_student_id
       and unassigned_at is null;
  end if;

  return v_student;
end;
$function$;
