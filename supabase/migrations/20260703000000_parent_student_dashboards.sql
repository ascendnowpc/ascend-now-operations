-- Parent/Student dashboards (2026-07-03)
--
-- Adds first-class parent accounts and the read access that lets a student
-- see their own packages/reports/session logs and a parent see their
-- children's — mirroring what the admin panel shows, but read-only.
--
--   * `parents` table — a parent gets a unique P-id (mirrors students' S-id)
--     and links to a login account (users.id). One parent can have several
--     children.
--   * `students.parent_id` — a student points at their parent's id.
--   * `enrollment_requests.student_email` — the enroll flow now collects a
--     separate student email and parent email so two distinct login accounts
--     can be created on confirmation (the existing `email` column stays the
--     parent/primary-contact email that the invoice + payment link go to).
--   * `can_view_student()` + SELECT policies so a student (own row) and a
--     parent (their children) can read the same balance/report/session data
--     admins and coaches already can — without granting any write access.

-- ─────────────────────────────────────────────────────────────────────────
-- parents
-- ─────────────────────────────────────────────────────────────────────────
create sequence if not exists public.parents_num_seq;

create table if not exists public.parents (
  id            text primary key default ('P' || nextval('public.parents_num_seq')),
  full_name     text,
  email         text,
  phone_number  text,
  address       text,
  country       text,
  user_id       uuid references public.users(id),
  created_at    timestamptz not null default now()
);

-- one login account maps to at most one parent row
create unique index if not exists parents_user_id_key
  on public.parents (user_id) where user_id is not null;

alter table public.parents enable row level security;

-- students point at their parent
alter table public.students
  add column if not exists parent_id text references public.parents(id);
create index if not exists idx_students_parent_id on public.students (parent_id);

-- separate student login email on the enrollment request (parent email stays
-- in the existing `email` column)
alter table public.enrollment_requests
  add column if not exists student_email text;

-- ─────────────────────────────────────────────────────────────────────────
-- can_view_student(): true if the caller is that student, or a parent of it.
-- SECURITY DEFINER so the check itself can read students/parents regardless
-- of the caller's own row-level access (same pattern as is_admin() etc.).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.can_view_student(p_student_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student_id and s.user_id = auth.uid()
  ) or exists (
    select 1
    from public.students s
    join public.parents p on p.id = s.parent_id
    where s.id = p_student_id and p.user_id = auth.uid()
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Grants — parents is a brand-new table, so both roles need base grants
-- (RLS filters rows on top of grants, it doesn't replace them).
-- ─────────────────────────────────────────────────────────────────────────
grant select, insert, update on public.parents to authenticated;
grant all on public.parents to service_role;
grant usage on sequence public.parents_num_seq to authenticated;
grant usage on sequence public.parents_num_seq to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS policies
-- ─────────────────────────────────────────────────────────────────────────

-- parents: admin full, parent reads own row (for the parent dashboard to
-- discover its own P-id and list its children)
drop policy if exists "admin_all_parents" on public.parents;
create policy "admin_all_parents" on public.parents
  for all using (is_admin()) with check (is_admin());

drop policy if exists "parent_read_own" on public.parents;
create policy "parent_read_own" on public.parents
  for select using (user_id = auth.uid());

-- student_packages
drop policy if exists "student_parent_read_packages" on public.student_packages;
create policy "student_parent_read_packages" on public.student_packages
  for select using (can_view_student(student_id));

-- package_topups (scoped through the package's student)
drop policy if exists "student_parent_read_topups" on public.package_topups;
create policy "student_parent_read_topups" on public.package_topups
  for select using (
    student_package_id in (
      select sp.id from public.student_packages sp where can_view_student(sp.student_id)
    )
  );

-- session_logs
drop policy if exists "student_parent_read_session_logs" on public.session_logs;
create policy "student_parent_read_session_logs" on public.session_logs
  for select using (student_id is not null and can_view_student(student_id));

-- invoices (reports)
drop policy if exists "student_parent_read_invoices" on public.invoices;
create policy "student_parent_read_invoices" on public.invoices
  for select using (can_view_student(student_id));

-- invoice_line_items (scoped through the invoice's student)
drop policy if exists "student_parent_read_invoice_line_items" on public.invoice_line_items;
create policy "student_parent_read_invoice_line_items" on public.invoice_line_items
  for select using (
    invoice_id in (
      select i.id from public.invoices i where can_view_student(i.student_id)
    )
  );

-- invoice_packages (scoped through the invoice's student)
drop policy if exists "student_parent_read_invoice_packages" on public.invoice_packages;
create policy "student_parent_read_invoice_packages" on public.invoice_packages
  for select using (
    invoice_id in (
      select i.id from public.invoices i where can_view_student(i.student_id)
    )
  );

-- pc_student_assignments — lets a student/parent see who the coordinator is
drop policy if exists "student_parent_read_pc_assignments" on public.pc_student_assignments;
create policy "student_parent_read_pc_assignments" on public.pc_student_assignments
  for select using (can_view_student(student_id));
