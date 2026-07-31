-- College Counsellor (CC) — step 2 of 2: the role flag, the assignment table,
-- its RLS, and the status RPC.
--
-- A CC is a `teachers` row flagged `is_college_counselor`, exactly the way a
-- Performance Coach is a row flagged `is_performance_coach`. The difference
-- between the two roles is durability, and it is why CC assignments carry a
-- status of their own while PC assignments do not:
--
--   * A PC assignment is permanent for the life of the engagement. Its
--     lifecycle IS the student's lifecycle, so the state lives on
--     `students.status` and `set_student_status()` closes the assignment when
--     the student is completed.
--   * A CC assignment is a finite piece of work (college counselling) that
--     ends while the student carries on with everything else. It therefore
--     gets its own active/completed status on the assignment row — a student
--     can be done with their counsellor and still be an active student.
--
-- Completing either one closes the assignment (`unassigned_at`), never
-- deletes it: session logs written during the assignment stay exactly where
-- they are, and the closed row is what still ties them to the counsellor who
-- wrote them.

-- ---------------------------------------------------------------------------
-- 1. The role flag
-- ---------------------------------------------------------------------------

alter table public.teachers
  add column if not exists is_college_counselor boolean not null default false;

comment on column public.teachers.is_college_counselor is
  'Marks this teacher as a College Counsellor (CC). Independent of is_performance_coach — a teacher may be both.';

-- ---------------------------------------------------------------------------
-- 2. The assignment table
-- ---------------------------------------------------------------------------

create table if not exists public.cc_student_assignments (
  id bigint generated always as identity primary key,
  student_id text not null references public.students (id) on delete cascade,
  cc_teacher_id text not null references public.teachers (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed')),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  status_changed_at timestamptz
);

comment on table public.cc_student_assignments is
  'Which College Counsellor a student is (or was) assigned to. Mirrors pc_student_assignments, plus an active/completed status of its own — a CC engagement ends independently of the student''s own status. Closed rows are kept so historical session logs stay attributable.';

-- One live counsellor per student, same shape as uq_active_pc_per_student.
create unique index if not exists uq_active_cc_per_student
  on public.cc_student_assignments (student_id)
  where unassigned_at is null;

create index if not exists idx_cc_assignments_teacher
  on public.cc_student_assignments (cc_teacher_id);

-- ---------------------------------------------------------------------------
-- 3. Helper
-- ---------------------------------------------------------------------------

-- Keyed off the teachers flag rather than users.role (the way
-- is_performance_coach() is) so that a teacher who is both a PC and a CC —
-- users.role can only hold one of the two — still gets CC access.
create or replace function public.is_college_counselor()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.teachers
    where user_id = auth.uid()
      and is_college_counselor
      and is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS — mirrors pc_student_assignments exactly. Note there is no INSERT or
--    UPDATE policy for counsellors: assigning is admin-only (see
--    20260801000300_pc_cannot_self_assign_students.sql for the PC precedent),
--    and status changes go through the SECURITY DEFINER RPC below.
-- ---------------------------------------------------------------------------

alter table public.cc_student_assignments enable row level security;

drop policy if exists admin_all_cc_assignments on public.cc_student_assignments;
create policy admin_all_cc_assignments
  on public.cc_student_assignments
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists cc_read_own_assignments on public.cc_student_assignments;
create policy cc_read_own_assignments
  on public.cc_student_assignments
  for select
  using (public.is_college_counselor() and cc_teacher_id = public.my_teacher_id());

drop policy if exists teachers_read_active_cc_assignments on public.cc_student_assignments;
create policy teachers_read_active_cc_assignments
  on public.cc_student_assignments
  for select
  using (
    unassigned_at is null
    and exists (select 1 from public.teachers where teachers.user_id = auth.uid())
  );

drop policy if exists student_parent_read_cc_assignments on public.cc_student_assignments;
create policy student_parent_read_cc_assignments
  on public.cc_student_assignments
  for select
  using (public.can_view_student(student_id));

-- A counsellor writes session logs as themselves, which the existing
-- "Teachers can insert their own session logs" / "Teachers can read their own
-- session logs" policies already allow. This adds the other half — reading the
-- logs their assigned students got from anyone — mirroring the PC policy.
drop policy if exists "CCs can read sessions for assigned students" on public.session_logs;
create policy "CCs can read sessions for assigned students"
  on public.session_logs
  for select
  using (
    public.is_college_counselor()
    and student_id in (
      select a.student_id from public.cc_student_assignments a
      where a.cc_teacher_id = public.my_teacher_id()
        and a.unassigned_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Status RPC
-- ---------------------------------------------------------------------------

-- Why a SECURITY DEFINER function instead of a plain UPDATE policy: marking an
-- assignment completed also has to close it (`unassigned_at`), and the two
-- writes must not be separable — a counsellor who could set the column
-- directly could mark themselves complete while staying assigned, or vice
-- versa. Same reasoning as set_student_status().
create or replace function public.set_cc_assignment_status(
  p_assignment_id bigint,
  p_status text
)
returns public.cc_student_assignments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.cc_student_assignments;
begin
  if p_status not in ('active', 'completed') then
    raise exception 'Invalid CC assignment status: %', p_status
      using errcode = 'check_violation';
  end if;

  select * into v_row
    from public.cc_student_assignments
   where id = p_assignment_id;

  if v_row.id is null then
    raise exception 'CC assignment % not found', p_assignment_id
      using errcode = 'no_data_found';
  end if;

  if not (
    public.is_admin()
    or (
      public.is_college_counselor()
      and v_row.cc_teacher_id = public.my_teacher_id()
    )
  ) then
    raise exception 'Not allowed to change CC assignment %', p_assignment_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_status = 'completed' then
    update public.cc_student_assignments
       set status = 'completed',
           unassigned_at = coalesce(unassigned_at, now()),
           status_changed_at = now()
     where id = p_assignment_id
    returning * into v_row;
  else
    -- Re-opening. uq_active_cc_per_student would reject this with a raw
    -- constraint error if the student has since been given another
    -- counsellor, so say so in plain language instead.
    if exists (
      select 1 from public.cc_student_assignments a
      where a.student_id = v_row.student_id
        and a.unassigned_at is null
        and a.id <> p_assignment_id
    ) then
      raise exception 'Student % already has an active College Counsellor', v_row.student_id
        using errcode = 'unique_violation';
    end if;

    update public.cc_student_assignments
       set status = 'active',
           unassigned_at = null,
           status_changed_at = now()
     where id = p_assignment_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Completing the student completes their CC engagement too
-- ---------------------------------------------------------------------------

-- Unchanged from the version in 20260805000000_student_status_categories.sql
-- except for the cc_student_assignments block at the end: a student who is
-- done is done with their counsellor as well, so leaving a live CC assignment
-- behind would leave them on that counsellor's active list forever.
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
$$;
