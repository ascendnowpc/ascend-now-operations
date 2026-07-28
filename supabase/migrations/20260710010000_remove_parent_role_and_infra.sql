-- Merge of the student & parent dashboards (2026-07-07), part 2 of 2.
--
-- The parent role is being removed entirely: there is no separate parent
-- login/account anymore, a student links to nothing but their own login, and
-- whatever parent contact info matters now lives directly on the student row
-- (see part 1's parent_full_name / parent_phone_number / notification_email).
--
-- MUST run AFTER the data purge that removed every parent account and every
-- non-Divija student, so no `users.role = 'parent'` rows remain when the
-- user_role enum is recreated without that value.

-- 1. can_view_student no longer has a parent branch — a student can only ever
--    see their own record.
create or replace function public.can_view_student(p_student_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student_id and s.user_id = auth.uid()
  );
$$;

-- 2. The non-admin relink guard drops its parent_id clause (that column is
--    about to be dropped); it still stops a non-admin swapping their login.
create or replace function public.prevent_non_admin_student_relink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.user_id is distinct from old.user_id then
      raise exception 'Only an admin can change which login account a student is linked to.';
    end if;
  end if;
  return new;
end;
$$;

-- 3. Parent-only policies + helper.
drop policy if exists parents_update_own_children on public.students;
drop policy if exists parents_read_children_users on public.users;
drop function if exists public.is_my_linked_child(text);

-- 4. The parents table itself (CASCADE drops its RLS policies, the
--    prevent_non_admin_parent_relink trigger on it, and the
--    students.parent_id FK), then the now-orphaned trigger function and the
--    parent_id column.
drop table if exists public.parents cascade;
drop function if exists public.prevent_non_admin_parent_relink();
alter table public.students drop column if exists parent_id;

-- 5. Recreate the user_role enum without 'parent'. No rows reference it as a
--    value anymore (the purge deleted every parent account), and only the
--    users.role column plus two plpgsql helpers (create_user_profile /
--    sync_teacher_pc_role, which reference the type by name in their bodies)
--    use it. Five legacy "Admins can manage all X" policies inline a
--    `users.role = 'admin'` check (rather than is_admin()), so the column
--    can't be retyped while they exist — drop them, swap the enum, then
--    recreate them byte-for-byte (they're functionally identical to
--    is_admin(), so behaviour is unchanged).
drop policy if exists "Admins can manage all curricula" on public.curricula;
drop policy if exists "Admins can manage all session_logs" on public.session_logs;
drop policy if exists "Admins can manage all subject_categories" on public.subject_categories;
drop policy if exists "Admins can manage all subjects" on public.subjects;
drop policy if exists "Admins can manage all teacher_subjects" on public.teacher_subjects;

alter type public.user_role rename to user_role_old;
create type public.user_role as enum ('teacher', 'student', 'performance_coach', 'admin');
alter table public.users
  alter column role type public.user_role using role::text::public.user_role;
drop type public.user_role_old;

create policy "Admins can manage all curricula" on public.curricula for all
  using (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role))
  with check (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role));
create policy "Admins can manage all session_logs" on public.session_logs for all
  using (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role))
  with check (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role));
create policy "Admins can manage all subject_categories" on public.subject_categories for all
  using (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role))
  with check (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role));
create policy "Admins can manage all subjects" on public.subjects for all
  using (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role))
  with check (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role));
create policy "Admins can manage all teacher_subjects" on public.teacher_subjects for all
  using (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role))
  with check (exists (select 1 from users where users.id = auth.uid() and users.role = 'admin'::user_role));
