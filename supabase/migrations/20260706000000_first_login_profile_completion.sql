-- ─────────────────────────────────────────────────────────────────────────
-- First-login mandatory profile completion (student + parent)
--
-- Admin add/renewal never requires phone/graduation-year/birthday/school —
-- admin often doesn't know them. Instead, a student/parent whose required
-- fields are still missing is shown a mandatory "complete your profile" form
-- the moment they log in (see StudentLayout.tsx/ParentLayout.tsx). There is
-- no separate "completed" flag: the gate is simply "is a required field
-- still null on the row", so a field admin already captured at enrollment
-- is never asked again, and a field one side fills (e.g. parent fills the
-- child's info because the child is too young for their own account) is
-- never re-asked of the other side either.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.students
  add column if not exists graduation_year smallint,
  add column if not exists birthday date,
  add column if not exists school text;

-- Optional on the admin enroll/renew form too — filled in when the admin
-- happens to know them, left null otherwise (same as phone_number already
-- works). enrollment_requests is a request/invoice draft, not the student
-- record itself; review-enrollment-payment copies these through to the new
-- students row on confirm.
alter table public.enrollment_requests
  add column if not exists graduation_year smallint,
  add column if not exists birthday date,
  add column if not exists school text;

-- Students/parents previously had no write access to their own row at all
-- (2026-07-05's RLS lockdown made `students` admin-write-only). The
-- mandatory first-login form, and the ongoing Profile tab it feeds into,
-- both need a student to update their own row and a parent to update their
-- own `parents` row and their children's `students` rows.
create policy "students_update_own"
  on public.students for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "parents_update_own_children"
  on public.students for update
  using (parent_id in (select id from public.parents where user_id = auth.uid()))
  with check (parent_id in (select id from public.parents where user_id = auth.uid()));

create policy "parents_update_own"
  on public.parents for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The two policies above let a student/parent UPDATE their own row, but RLS
-- USING/WITH CHECK can't restrict which *columns* change within an allowed
-- row — without a guard, a student could re-point their own `parent_id` at
-- any existing parent's id (or a parent could do the same via their own
-- `user_id`), handing an unrelated account read access to their
-- session/package data through `can_view_student()`. Only admin (via
-- `review-enrollment-payment`/`StudentDetailView.tsx`) may change these
-- identity links; a self-service update must leave them untouched.
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

create trigger trg_prevent_non_admin_student_relink
  before update on public.students
  for each row execute function public.prevent_non_admin_student_relink();

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

create trigger trg_prevent_non_admin_parent_relink
  before update on public.parents
  for each row execute function public.prevent_non_admin_parent_relink();
