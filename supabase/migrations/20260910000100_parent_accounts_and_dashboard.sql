-- Parent accounts, part 2 of 2 — the `parents` table, the student link, and
-- the read access behind the parent dashboard (2026-09-10).
--
-- Shape of the feature: a parent is a household account. One parent row owns a
-- login and any number of children, so a second child enrolled into an
-- existing family reuses the parent that is already there instead of creating
-- a duplicate. `students.parent_id` is the link, nullable — every student
-- already in the system has no parent account and stays perfectly valid
-- without one.
--
-- Access is deliberately READ-ONLY. A parent sees what their children's own
-- dashboards show and can change nothing: no student profile edits (the
-- 2026-07-06 `parents_update_own_children` policy is NOT restored), and no
-- homework submitting on a child's behalf (see the submissions note below).
--
-- Ids follow the same mnemonic format as every other person in the system
-- (students 20260804000500/000600, staff 20260804000900):
--   3 letters of first_name + 1 of last_name + 2-digit year + '-' + sequence
--   e.g. Sarah Khan enrolled in 2026 -> SARK26-1
--
-- Recursion note, because this exact table caused an outage once before
-- (20260707000000_fix_students_parents_relink_recursion): a policy ON
-- `students` must never subquery `parents` inline, since `parents`' own
-- policies subquery `teachers`/`students` right back and Postgres re-plans
-- every policy on the table for each statement. Every cross-table test here
-- goes through a SECURITY DEFINER helper, which runs outside RLS
-- re-evaluation and breaks the cycle.

-- ─────────────────────────────────────────────────────────────────────────
-- parents
-- ─────────────────────────────────────────────────────────────────────────
create sequence if not exists public.parents_num_seq;

create table if not exists public.parents (
  id           text primary key,
  first_name   text not null,
  last_name    text not null,
  -- The address credentials were sent to and where the account's mail goes.
  -- Also the natural duplicate check when an admin adds a sibling.
  email        text,
  phone_number text,
  -- The login. Nullable so a parent record can exist before/without an
  -- account, mirroring how `students.user_id` behaves pre-enrollment.
  user_id      uuid references public.users(id),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

comment on table public.parents is
  'A household parent/guardian account. Owns one login and any number of students via students.parent_id — a sibling reuses the existing row. Read-only access to their children''s data; see 20260910000100.';

-- One login maps to at most one parent row (same guarantee students.user_id
-- and teachers.user_id carry).
create unique index if not exists parents_user_id_key
  on public.parents (user_id) where user_id is not null;

-- Backs the "is this family already in the system?" lookup on the enroll
-- form. Case-insensitive because an admin retyping an address rarely matches
-- the original casing.
create index if not exists parents_email_lower_idx
  on public.parents (lower(email)) where email is not null;

-- Mnemonic id, generated the same way students' and staff's are. Only fires
-- when no id was supplied, so a seed/fixture row can still pin its own.
create or replace function public.generate_parent_id()
returns trigger
language plpgsql
as $$
declare
  name_part text;
  surname_part text;
begin
  if NEW.id is not null then
    return NEW;
  end if;

  -- Letters only, so a hyphenated/apostrophe'd/accented name never breaks the
  -- format; fewer than 3 latin letters (or none) pads with 'X' rather than
  -- erroring — the trailing sequence number is what guarantees uniqueness.
  name_part := upper(left(regexp_replace(NEW.first_name, '[^A-Za-z]', '', 'g'), 3));
  name_part := rpad(name_part, 3, 'X');

  surname_part := upper(left(regexp_replace(coalesce(NEW.last_name, ''), '[^A-Za-z]', '', 'g'), 1));
  if surname_part = '' then
    surname_part := 'X';
  end if;

  NEW.id := name_part || surname_part || to_char(now(), 'YY') || '-' ||
            nextval('public.parents_num_seq')::text;
  return NEW;
end;
$$;

drop trigger if exists trg_generate_parent_id on public.parents;
create trigger trg_generate_parent_id before insert on public.parents
  for each row execute function public.generate_parent_id();

-- ─────────────────────────────────────────────────────────────────────────
-- students.parent_id — which household a student belongs to
-- ─────────────────────────────────────────────────────────────────────────
alter table public.students
  add column if not exists parent_id text references public.parents(id);

create index if not exists idx_students_parent_id on public.students (parent_id);

comment on column public.students.parent_id is
  'The parent/guardian account this student belongs to; null when the family has no login. Siblings share one parents row. The plain parent_full_name/parent_phone_number columns stay as contact info and are independent of this link.';

-- ─────────────────────────────────────────────────────────────────────────
-- enrollment_requests.parent_id — carries the choice through to confirm
-- ─────────────────────────────────────────────────────────────────────────
-- A new student is never INSERTed by the UI; the enroll form files a request
-- and `review-enrollment-payment` creates the students row once payment is
-- confirmed. So the parent picked on that form has to travel with the request
-- to be copied onto the student. The parent account itself is created up front
-- (its own /admin/parents/new route, credentials emailed there and then) — by
-- the time a request is filed the parent already exists, so this is a plain
-- FK, never a set of pending name/email fields.
alter table public.enrollment_requests
  add column if not exists parent_id text references public.parents(id);

comment on column public.enrollment_requests.parent_id is
  'The parent account this enrollment''s student belongs to, copied to students.parent_id on confirm. Null when the family has no parent account.';

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers (all SECURITY DEFINER — see the recursion note at the top)
-- ─────────────────────────────────────────────────────────────────────────

-- The caller's own parent row id, or null when they aren't a parent.
create or replace function public.my_parent_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select id from public.parents
  where user_id = auth.uid()
  limit 1;
$$;

-- Does this parent row belong to the caller? Used by any policy that needs to
-- test a `parent_id` column without subquerying `parents` inline.
create or replace function public.is_my_linked_child(p_parent_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.parents p
    where p.id = p_parent_id and p.user_id = auth.uid()
  );
$$;

-- "This is the caller's OWN student record" — exactly what can_view_student()
-- meant before this migration widened it. Split out so the handful of policies
-- that grant a student WRITE access keep meaning the student themselves and
-- are not silently widened to parents; see the submissions policy below.
create or replace function public.is_own_student_record(p_student_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student_id and s.user_id = auth.uid()
  );
$$;

-- The read gate the whole student/parent portal hangs off: true when the
-- caller is that student, or a parent of them. Widening it here is what grants
-- a parent read access to their children's packages, session logs, invoices,
-- homework, subject notes and coach/counsellor assignments in one move — those
-- 13 policies already call this function and are left untouched.
create or replace function public.can_view_student(p_student_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student_id
      and (
        s.user_id = auth.uid()
        or (
          s.parent_id is not null
          and exists (
            select 1 from public.parents p
            where p.id = s.parent_id and p.user_id = auth.uid()
          )
        )
      )
  );
$$;

comment on function public.can_view_student(text) is
  'True when the caller is that student, or a parent linked to them. READ gate only — a policy granting writes must use is_own_student_record() instead (2026-09-10).';

-- ─────────────────────────────────────────────────────────────────────────
-- Keep the one write path that rides on can_view_student() student-only
-- ─────────────────────────────────────────────────────────────────────────
-- `submissions` is the only FOR ALL policy keyed on can_view_student(), so
-- widening that function above would otherwise have let a parent start, edit
-- and submit their child's homework. Re-point it at is_own_student_record(),
-- which is byte-for-byte the old can_view_student() body: behaviour for a
-- student is completely unchanged, and a parent reads these rows through the
-- separate SELECT policy below instead.
drop policy if exists "Students manage their own submissions" on public.submissions;
create policy "Students manage their own submissions"
  on public.submissions for all
  using (public.is_own_student_record(student_id))
  with check (public.is_own_student_record(student_id));

-- The read half a parent still needs (their child's answers, so "handed in vs
-- not" and the graded paper are visible on the dashboard).
drop policy if exists "parent_read_children_submissions" on public.submissions;
create policy "parent_read_children_submissions"
  on public.submissions for select
  using (public.can_view_student(student_id));

-- ─────────────────────────────────────────────────────────────────────────
-- RLS on parents
-- ─────────────────────────────────────────────────────────────────────────
alter table public.parents enable row level security;

drop policy if exists "admin_all_parents" on public.parents;
create policy "admin_all_parents" on public.parents
  for all using (public.is_admin()) with check (public.is_admin());

-- A parent reads their own row (the dashboard needs it to find its own id and
-- from there its children). Nothing lets a parent write it — name/email changes
-- go through an admin, same as a student's.
drop policy if exists "parent_read_own" on public.parents;
create policy "parent_read_own" on public.parents
  for select using (user_id = auth.uid());

-- Any staff member can read parent rows, matching "Staff can read all
-- students" — a coach opening a student's detail page needs the linked
-- household shown, and staff can already read the parent name/phone that sit
-- directly on the student row, so this exposes nothing new. Scoped through
-- `teachers` (not `students`) so it cannot re-create the 2026-07-07 recursion.
drop policy if exists "staff_read_parents" on public.parents;
create policy "staff_read_parents" on public.parents
  for select using (
    exists (select 1 from public.teachers t where t.user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────
-- users — a parent reads their children's user rows
-- ─────────────────────────────────────────────────────────────────────────
-- So the dashboard can show each child's username/full name. Expressed
-- directly rather than through a helper: `users`' own policies never subquery
-- students/parents, so there is no cycle to break here (same reasoning as the
-- 2026-07-08 version of this policy).
drop policy if exists "parents_read_children_users" on public.users;
create policy "parents_read_children_users"
  on public.users for select
  using (
    id in (
      select s.user_id from public.students s
      join public.parents p on p.id = s.parent_id
      where p.user_id = auth.uid() and s.user_id is not null
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- pc_profiles — a parent reads their children's coach / counsellor card
-- ─────────────────────────────────────────────────────────────────────────
-- The twin of the two "Students read their assigned …" policies, scoped the
-- same way but through the parent link, so the "My child's PC/CC" tabs render
-- the same profile card the student sees.
drop policy if exists "parents_read_children_coach_pc_profile" on public.pc_profiles;
create policy "parents_read_children_coach_pc_profile"
  on public.pc_profiles for select
  using (
    exists (
      select 1
      from public.pc_student_assignments a
      where a.pc_teacher_id = pc_profiles.teacher_id
        and a.unassigned_at is null
        and public.can_view_student(a.student_id)
    )
  );

drop policy if exists "parents_read_children_counsellor_pc_profile" on public.pc_profiles;
create policy "parents_read_children_counsellor_pc_profile"
  on public.pc_profiles for select
  using (
    exists (
      select 1
      from public.cc_student_assignments a
      where a.cc_teacher_id = pc_profiles.teacher_id
        and a.unassigned_at is null
        and public.can_view_student(a.student_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Grants — RLS filters rows on top of grants, it does not replace them.
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT only for `authenticated`: every write to this table happens either as
-- an admin through PostgREST (covered by admin_all_parents… which still needs
-- the grant) or as service_role in the create-parent-with-user edge function.
grant select, insert, update on public.parents to authenticated;
grant all on public.parents to service_role;

-- The sequence backs a text PK through a trigger, not an identity column, so
-- per db/README.md's "one rule to never forget" it needs USAGE explicitly —
-- an INSERT grant on the table is not enough.
grant usage on sequence public.parents_num_seq to authenticated, service_role;
