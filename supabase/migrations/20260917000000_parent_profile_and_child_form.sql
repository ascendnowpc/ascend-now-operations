-- Parents fill in their own details, and their young children's (2026-09-17).
--
-- Three things a parent account could not do until now, all of them writes:
--
--  1. Say where they live and what they do. `parents` carried name/email/phone
--     and nothing else, and a parent had no write access to their own row at
--     all — so the first-login gate every other role has (student, teacher,
--     admin) had nothing to ask for and did not exist. `country`/`profession`
--     are that ask.
--
--  2. Fill in their child's profile. `students` requires phone, school,
--     curriculum, address, birthday, graduation year and the guardian's
--     name/phone before the child's own dashboard unlocks — which assumes the
--     child is old enough to have logged in and typed them. For a young child
--     the parent is the only person who knows any of it, so the 2026-07-06
--     `parents_update_own_children` policy comes back (it was dropped with the
--     table on 2026-07-10 and deliberately not restored on 2026-09-10, when
--     parent access was read-only by design).
--
--  3. Be maintained by a Performance Coach. A coach could already READ every
--     parent row (`staff_read_parents`); now they can correct one belonging to
--     a student on their own roster.
--
-- `can_view_student()` stays a READ gate and is untouched — every write added
-- here is its own policy, keyed on the parent link (2) or the coach's roster
-- (3), so nothing rides in on the read helper by accident.
--
-- Recursion note (this table caused an outage on 2026-07-07 and the shape of
-- that bug is easy to recreate): a policy ON `parents` must not subquery
-- `students` inline, and a policy ON `students` must not subquery `parents`
-- inline — Postgres re-plans every policy on a table for each statement, so
-- the two sets reach into each other and loop. Both new cross-table tests below
-- go through a SECURITY DEFINER helper, which runs outside RLS re-evaluation.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. parents.country / parents.profession
-- ─────────────────────────────────────────────────────────────────────────
alter table public.parents
  add column if not exists country    text,
  add column if not exists profession text;

comment on column public.parents.country is
  'Where the parent lives. Asked at their first login (ParentCompleteProfileGate) and editable by them, an admin, or their child''s coach. Independent of students.country, which is the child''s own.';

comment on column public.parents.profession is
  'The parent''s occupation, free text — asked alongside country at first login. Purely informational; nothing branches on it.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. A parent writes their own row
-- ─────────────────────────────────────────────────────────────────────────
-- Restores the 2026-07-06 policy of the same name. What it is FOR is the
-- first-login gate: country/profession are never collected at admin add time
-- (admin adds a parent from an email address and a name), so this is the one
-- place they can be filled in.
drop policy if exists "parents_update_own" on public.parents;
create policy "parents_update_own" on public.parents
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- RLS cannot say WHICH columns may change within a row it allows, so without
-- this a parent could re-point their own `user_id` at another login. Restored
-- verbatim from 20260706000000 (it was dropped with the table on 2026-07-10).
create or replace function public.prevent_non_admin_parent_relink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.user_id is distinct from old.user_id then
      raise exception 'Only an admin can change which login account a parent is linked to.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_non_admin_parent_relink on public.parents;
create trigger trg_prevent_non_admin_parent_relink
  before update on public.parents
  for each row execute function public.prevent_non_admin_parent_relink();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. A parent writes their own children's rows
-- ─────────────────────────────────────────────────────────────────────────
-- Goes through is_my_linked_child() rather than the inline
-- `parent_id in (select id from parents where …)` the 2026-07-06 version used
-- — that inline subquery IS the 2026-07-07 recursion, and the helper is the
-- fix that was written for it.
drop policy if exists "parents_update_own_children" on public.students;
create policy "parents_update_own_children"
  on public.students for update
  using (public.is_my_linked_child(parent_id))
  with check (public.is_my_linked_child(parent_id));

-- The same column guard as above, for students. `prevent_non_admin_student_relink`
-- already exists but has only guarded `user_id` since 2026-07-10, when
-- `students.parent_id` was dropped and the clause covering it went with the
-- column; `parent_id` came back on 2026-09-10 and the clause did not. It
-- matters now: without it the policy above would let a parent (or a student,
-- via students_update_own) re-point a `parent_id` at any household id they
-- like and hand that account read access to the child's whole record through
-- can_view_student().
create or replace function public.prevent_non_admin_student_relink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.parent_id is distinct from old.parent_id or new.user_id is distinct from old.user_id then
      raise exception 'Only an admin can change which parent or login account a student is linked to.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_non_admin_student_relink on public.students;
create trigger trg_prevent_non_admin_student_relink
  before update on public.students
  for each row execute function public.prevent_non_admin_student_relink();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. A coach writes the parent rows of their own students
-- ─────────────────────────────────────────────────────────────────────────
-- Scoped to the caller's current roster rather than "any staff", which is what
-- `staff_read_parents` settles for on the read side: reading a family's phone
-- number exposes nothing a coach can't already see on the student row, whereas
-- overwriting one is worth confining to the families they actually coach.
--
-- The roster lookup touches `students`, so it lives inside a SECURITY DEFINER
-- helper — see the recursion note at the top. Matches is_my_assigned_student()
-- in treating a PC and a CC roster alike (20260808000000).
create or replace function public.is_parent_of_my_assigned_student(p_parent_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_parent_id is not null and (
    exists (
      select 1
      from public.students s
      join public.pc_student_assignments a
        on a.student_id = s.id and a.unassigned_at is null
      where s.parent_id = p_parent_id
        and a.pc_teacher_id = public.my_teacher_id()
    )
    or exists (
      select 1
      from public.students s
      join public.cc_student_assignments a
        on a.student_id = s.id and a.unassigned_at is null
      where s.parent_id = p_parent_id
        and a.cc_teacher_id = public.my_teacher_id()
    )
  );
$$;

comment on function public.is_parent_of_my_assigned_student(text) is
  'True when the caller coaches (PC) or counsels (CC) at least one child of that household. SECURITY DEFINER so a policy on `parents` never subqueries `students` inline — see the 2026-07-07 recursion.';

drop policy if exists "staff_update_assigned_parents" on public.parents;
create policy "staff_update_assigned_parents" on public.parents
  for update
  using (public.is_coach_or_counselor() and public.is_parent_of_my_assigned_student(id))
  with check (public.is_coach_or_counselor() and public.is_parent_of_my_assigned_student(id));

grant execute on function public.is_parent_of_my_assigned_student(text) to authenticated, service_role;
