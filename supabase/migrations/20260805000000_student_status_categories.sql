-- Student lifecycle status: Active / On pause / Completed.
--
-- A Performance Coach (and an admin) can now move any student through three
-- states, and the admin + PC student lists group students by them:
--   'active'    — the default; a normally running engagement.
--   'paused'    — temporarily on hold, still assigned to their coach.
--   'completed' — the engagement is finished. Completing a student ALSO ends
--                 their PC assignment (see set_student_status below), so a
--                 completed student is by definition unassigned.
--
-- The status lives on `students`, not on `pc_student_assignments`, precisely
-- because "completed" outlives the assignment row that produced it — putting
-- it on the assignment would make the state vanish at the moment it's set.

alter table public.students
  add column if not exists status text not null default 'active',
  add column if not exists status_changed_at timestamptz;

alter table public.students
  drop constraint if exists students_status_valid;

alter table public.students
  add constraint students_status_valid
  check (status in ('active', 'paused', 'completed'));

-- Every list view filters/groups on this.
create index if not exists idx_students_status on public.students (status);

-- Changing a student's status is done through this function rather than a
-- direct UPDATE for two reasons:
--   1) Postgres RLS is row-level, not column-level — there is no way to write
--      a policy that lets a coach update `status` and nothing else on
--      `students`. A SECURITY DEFINER function with an explicit permission
--      check is the column-scoped grant the policy system can't express.
--   2) Completing a student must also close their active PC assignment, and a
--      coach has no UPDATE policy at all on `pc_student_assignments`
--      (assign/unassign is admin-only, see 20260706000000 / 20260801000300).
--      Doing both writes here keeps them atomic and keeps that rule intact.
--
-- Permission: admins may set the status of any student; a performance coach
-- may set it only for a student CURRENTLY assigned to them. A coach therefore
-- cannot re-open a student they completed (completing unassigned them) — an
-- admin re-assigns them from /admin/pc-assignments.
create or replace function public.set_student_status(p_student_id text, p_status text)
returns public.students
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_student public.students;
begin
  if p_status not in ('active', 'paused', 'completed') then
    raise exception 'Invalid student status: %', p_status
      using errcode = 'check_violation';
  end if;

  if not (
    public.is_admin()
    or (
      public.is_performance_coach()
      and exists (
        select 1 from public.pc_student_assignments a
        where a.student_id = p_student_id
          and a.unassigned_at is null
          and a.pc_teacher_id = public.my_teacher_id()
      )
    )
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

  -- Completing an engagement ends the coach assignment too.
  if p_status = 'completed' then
    update public.pc_student_assignments
       set unassigned_at = now()
     where student_id = p_student_id
       and unassigned_at is null;
  end if;

  return v_student;
end;
$$;

grant execute on function public.set_student_status(text, text) to authenticated;
