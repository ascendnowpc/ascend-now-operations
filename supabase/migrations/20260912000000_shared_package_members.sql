-- Shared packages are shared by NAMED children, not by "whoever is in the
-- family" — and only the course types that are actually sold that way
-- (2026-09-12).
--
-- What 20260911000000_family_packages.sql built: a package owned by a parent
-- was drawn down by EVERY child linked to that parent, for any course type.
-- Two rules from the business change that:
--
--   1. Not every programme is shareable. Only Academic and Beyond Academic
--      (which is where Passion Projects live) are sold as hours a household
--      shares. College Counselling, and the Foundation Program / All-In-One
--      bundles that contain a College Counselling pool, are bought per child.
--   2. A shared package is shared by exactly TWO named children, assigned by
--      an admin when the package is created. The parent is never asked to
--      choose, and a third sibling does not silently start spending a pool
--      that was sold for two.
--
-- So parent ownership no longer implies who may spend. `parent_id` still says
-- which household the pool belongs to (it is what groups the pools on the
-- family's page, and what the one-current-pool-per-family index keys on); the
-- new `student_package_members` says who actually draws on it. Everything that
-- used to read "every child of this parent" — the session-log router, RLS, the
-- per-sibling usage RPC — now reads the membership rows instead.
--
-- Existing family packages are backfilled with every child currently linked to
-- the parent, so nothing that is live today changes hands. The shareable-course
-- -type rule is enforced going forward only (the trigger fires on INSERT and on
-- an UPDATE that touches parent_id/course_type_id), which deliberately
-- grandfathers the pre-existing College Counselling / All-In-One family pools
-- rather than guessing which single child should inherit them.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Which course types may be shared at all
-- ─────────────────────────────────────────────────────────────────────────
-- A column on course_types rather than a hard-coded name list, so the rule is
-- one row edit rather than a migration when the business sells something new
-- as shared. Default false: a course type is bought per child until someone
-- says otherwise.
alter table public.course_types
  add column if not exists is_shareable boolean not null default false;

update public.course_types set is_shareable = true
  where name in ('Academic', 'Beyond Academic');

comment on column public.course_types.is_shareable is
  'True when hours of this course type may be bought once and shared between two siblings (Academic, Beyond Academic). False — the default — means the course type is bought per student. Enforced by validate_shared_package_course_type() (2026-09-12).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Who shares a package
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.student_package_members (
  student_package_id bigint not null references public.student_packages(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  added_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (student_package_id, student_id)
);

create index if not exists idx_student_package_members_student_id
  on public.student_package_members (student_id);

comment on table public.student_package_members is
  'The children who draw on a shared (parent-owned) package — exactly two, named by an admin when the package is created. Parent ownership alone no longer grants a sibling access to the pool (2026-09-12).';

alter table public.student_package_members enable row level security;

grant select, insert, update, delete on public.student_package_members to authenticated, service_role;

-- Backfill: every child currently linked to the parent, so today's family
-- pools keep behaving exactly as they do now.
insert into public.student_package_members (student_package_id, student_id)
select sp.id, s.id
from public.student_packages sp
join public.students s on s.parent_id = sp.parent_id
where sp.parent_id is not null
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. The rules a membership row has to satisfy
-- ─────────────────────────────────────────────────────────────────────────
-- A CHECK constraint can't reach other tables, so these are a trigger. All
-- three failures are admin mistakes that must not reach the data: sharing a
-- student-owned package, adding a child from another household, and stretching
-- a two-child pool to a third.
create or replace function public.validate_student_package_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pkg_parent_id text;
  stu_parent_id text;
  other_members int;
begin
  select sp.parent_id into pkg_parent_id
    from public.student_packages sp where sp.id = new.student_package_id;
  if not found then
    raise exception 'Package % does not exist.', new.student_package_id;
  end if;
  if pkg_parent_id is null then
    raise exception 'Package % is owned by a student, not a family — only a shared package has members.',
      new.student_package_id;
  end if;

  select s.parent_id into stu_parent_id
    from public.students s where s.id = new.student_id;
  if stu_parent_id is distinct from pkg_parent_id then
    raise exception 'Student % is not a child of parent % and cannot share that package.',
      new.student_id, pkg_parent_id;
  end if;

  -- Two per shared package, the number the business assigns. Change it here
  -- and in SHARED_PACKAGE_STUDENT_COUNT (src/utils/sharedPackages.ts) together.
  select count(*) into other_members
    from public.student_package_members m
    where m.student_package_id = new.student_package_id
      and m.student_id is distinct from new.student_id;
  if other_members >= 2 then
    raise exception 'A shared package is shared by 2 students; package % already has %.',
      new.student_package_id, other_members;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_student_package_member on public.student_package_members;
create trigger trg_validate_student_package_member
  before insert or update on public.student_package_members
  for each row execute function public.validate_student_package_member();

-- Only a shareable course type may be bought as a shared package. Fires on
-- INSERT, and on an UPDATE only when ownership or course type is actually
-- being set — so recompute_package_hours_used()'s hours_used writes never trip
-- it, and the pre-existing non-shareable family pools are left alone.
create or replace function public.validate_shared_package_course_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shareable boolean;
  ct_name text;
begin
  if new.parent_id is null then return new; end if;
  select ct.is_shareable, ct.name into shareable, ct_name
    from public.course_types ct where ct.id = new.course_type_id;
  if not coalesce(shareable, false) then
    raise exception '% is bought per student and cannot be shared between siblings.',
      coalesce(ct_name, 'Course type ' || new.course_type_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_shared_package_course_type on public.student_packages;
create trigger trg_validate_shared_package_course_type
  before insert or update of parent_id, course_type_id on public.student_packages
  for each row execute function public.validate_shared_package_course_type();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Which pools a student may draw on
-- ─────────────────────────────────────────────────────────────────────────
-- Their own, plus the shared pools they were named on. Same single definition
-- the session-log trigger, RLS and the usage RPC all go through — being a
-- child of the owning parent is no longer enough on its own.
create or replace function public.student_package_ids(p_student_id text)
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select sp.id from public.student_packages sp where sp.student_id = p_student_id
  union
  select m.student_package_id from public.student_package_members m where m.student_id = p_student_id;
$$;

comment on function public.student_package_ids(text) is
  'Every package a student may draw on: their own, plus the shared pools they are a named member of (2026-09-12).';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Who can see a shared package
-- ─────────────────────────────────────────────────────────────────────────
-- Membership is per package, not per household, so these take the package id
-- as well. The two-argument versions from 2026-09-11 are dropped at the end of
-- this section once nothing references them.
create or replace function public.can_view_package(p_package_id bigint, p_student_id text, p_parent_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_student_id is not null then public.can_view_student(p_student_id)
    when p_parent_id is not null then
      -- the parent themselves — every pool of their household is theirs to see…
      exists (select 1 from public.parents p where p.id = p_parent_id and p.user_id = auth.uid())
      -- …or a child NAMED on this pool. A sibling who isn't on it can't spend
      -- it and has no business reading it.
      or exists (
        select 1
        from public.student_package_members m
        join public.students s on s.id = m.student_id
        where m.student_package_id = p_package_id and s.user_id = auth.uid()
      )
    else false
  end;
$$;

create or replace function public.is_my_assigned_package(p_package_id bigint, p_student_id text, p_parent_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_student_id is not null then public.is_my_assigned_student(p_student_id)
    when p_parent_id is not null then exists (
      select 1 from public.student_package_members m
      where m.student_package_id = p_package_id and public.is_my_assigned_student(m.student_id)
    )
    else false
  end;
$$;

drop policy if exists "student_parent_read_packages" on public.student_packages;
create policy "student_parent_read_packages" on public.student_packages
  for select using (public.can_view_package(id, student_id, parent_id));

drop policy if exists "pc_manage_assigned_packages" on public.student_packages;
create policy "pc_manage_assigned_packages" on public.student_packages
  for all
  using (public.is_coach_or_counselor() and public.is_my_assigned_package(id, student_id, parent_id))
  with check (public.is_coach_or_counselor() and public.is_my_assigned_package(id, student_id, parent_id));

drop policy if exists "student_parent_read_topups" on public.package_topups;
create policy "student_parent_read_topups" on public.package_topups
  for select using (
    student_package_id in (
      select sp.id from public.student_packages sp
      where public.can_view_package(sp.id, sp.student_id, sp.parent_id)
    )
  );

drop policy if exists "pc_select_own_topups" on public.package_topups;
create policy "pc_select_own_topups" on public.package_topups
  for select using (
    public.is_coach_or_counselor() and exists (
      select 1 from public.student_packages sp
      where sp.id = package_topups.student_package_id
        and public.is_my_assigned_package(sp.id, sp.student_id, sp.parent_id)
    )
  );

drop policy if exists "pc_insert_own_topups" on public.package_topups;
create policy "pc_insert_own_topups" on public.package_topups
  for insert with check (
    public.is_coach_or_counselor() and exists (
      select 1 from public.student_packages sp
      where sp.id = package_topups.student_package_id
        and public.is_my_assigned_package(sp.id, sp.student_id, sp.parent_id)
    )
  );

drop function if exists public.can_view_package(text, text);
drop function if exists public.is_my_assigned_package(text, text);

-- Membership rows follow their package's visibility: if you may see the pool,
-- you may see who shares it. Writing them is an admin/coach action, the same
-- people who may write the package itself.
drop policy if exists "admin_all_package_members" on public.student_package_members;
create policy "admin_all_package_members" on public.student_package_members
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "student_parent_read_package_members" on public.student_package_members;
create policy "student_parent_read_package_members" on public.student_package_members
  for select using (
    student_package_id in (
      select sp.id from public.student_packages sp
      where public.can_view_package(sp.id, sp.student_id, sp.parent_id)
    )
  );

drop policy if exists "pc_manage_assigned_package_members" on public.student_package_members;
create policy "pc_manage_assigned_package_members" on public.student_package_members
  for all
  using (
    public.is_coach_or_counselor() and exists (
      select 1 from public.student_packages sp
      where sp.id = student_package_members.student_package_id
        and public.is_my_assigned_package(sp.id, sp.student_id, sp.parent_id)
    )
  )
  with check (
    public.is_coach_or_counselor() and exists (
      select 1 from public.student_packages sp
      where sp.id = student_package_members.student_package_id
        and public.is_my_assigned_package(sp.id, sp.student_id, sp.parent_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Who used the shared hours
-- ─────────────────────────────────────────────────────────────────────────
-- Now returns a row for every NAMED member, spent or not, so "shared by Batu
-- and Test1" reads off the same call that says who spent what — a member who
-- has used nothing comes back at 0 rather than disappearing. Any student who
-- has drawn on the pool without being a member (a legacy pool from before
-- membership existed) still appears, so no spent hour goes unattributed.
create or replace function public.family_package_usage_by_student(p_package_id bigint)
returns table (
  student_id text,
  first_name text,
  last_name text,
  sessions integer,
  no_shows integer,
  hours numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
BEGIN
  -- The caller must be able to see the package itself; otherwise this would be
  -- a way to read usage for any family by guessing an id.
  IF NOT (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.student_packages sp
      WHERE sp.id = p_package_id
        AND (public.can_view_package(sp.id, sp.student_id, sp.parent_id)
             OR (public.is_coach_or_counselor()
                 AND public.is_my_assigned_package(sp.id, sp.student_id, sp.parent_id)))
    )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH involved AS (
    SELECT m.student_id FROM public.student_package_members m
      WHERE m.student_package_id = p_package_id
    UNION
    SELECT sl.student_id FROM public.session_logs sl
      WHERE sl.student_package_id = p_package_id AND sl.student_id IS NOT NULL
  ),
  spent AS (
    SELECT
      sl.student_id AS sid,
      count(*) FILTER (WHERE sl.no_show_type IS NULL)::int AS sessions,
      count(*) FILTER (WHERE sl.no_show_type IS NOT NULL)::int AS no_shows,
      COALESCE(SUM(sl.session_duration_hrs) FILTER (
        WHERE sl.no_show_type IS DISTINCT FROM 'no_show_1'
          AND sl.no_show_type IS DISTINCT FROM 'no_show_2'
      ), 0)::numeric AS hours
    FROM public.session_logs sl
    WHERE sl.student_package_id = p_package_id
    GROUP BY sl.student_id
  )
  SELECT
    s.id,
    s.first_name,
    s.last_name,
    COALESCE(spent.sessions, 0),
    COALESCE(spent.no_shows, 0),
    COALESCE(spent.hours, 0)::numeric
  FROM involved
  JOIN public.students s ON s.id = involved.student_id
  LEFT JOIN spent ON spent.sid = s.id
  ORDER BY s.id;
END;
$$;

comment on function public.family_package_usage_by_student(bigint) is
  'Per-student session/no-show/hour totals for one package — every named member plus anyone who has drawn on it, members at 0 included. Aggregates inside SECURITY DEFINER so a student can see how much of a shared pool their sibling used without gaining any access to that sibling''s session logs (2026-09-12).';

grant execute on function public.student_package_ids(text) to authenticated, service_role;
grant execute on function public.can_view_package(bigint, text, text) to authenticated, service_role;
grant execute on function public.is_my_assigned_package(bigint, text, text) to authenticated, service_role;
grant execute on function public.family_package_usage_by_student(bigint) to authenticated, service_role;
grant execute on function public.validate_student_package_member() to authenticated, service_role;
grant execute on function public.validate_shared_package_course_type() to authenticated, service_role;
