-- The invoice flow can sell a SHARED package too (2026-09-12).
--
-- `/admin/packages/new` could create a shared package from the moment
-- 20260912000000 landed, but that form deliberately involves no money. Every
-- package sold against an invoice — the main way hours are actually bought —
-- still came out student-owned, so a family buying Academic hours for two
-- children had to be invoiced for one child and then have the pool rebuilt by
-- hand afterwards. This closes that gap: an enrollment request's package line
-- can now say "this one is shared", and confirming the payment creates the
-- parent-owned pool with its two members instead of a student-owned one.
--
-- **Only the co-sharers are stored.** The student the request is FOR is always
-- a member, and on a new-student enrollment that student has no id yet — they
-- are created by `review-enrollment-payment` at confirm time. So a shared line
-- records the OTHER child (one of them, for a pair), who already exists and can
-- carry a real foreign key, and the confirm step adds the enrolling student
-- alongside them. That also makes the row mean the same thing on a renewal and
-- on a first enrollment, rather than being populated one way for each.

alter table public.enrollment_request_packages
  add column if not exists is_shared boolean not null default false;

comment on column public.enrollment_request_packages.is_shared is
  'True when confirming this line should create a SHARED (parent-owned) pool rather than a student-owned one. The members are the request''s own student plus everyone in enrollment_request_package_members (2026-09-12).';

create table if not exists public.enrollment_request_package_members (
  enrollment_request_package_id uuid not null
    references public.enrollment_request_packages(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (enrollment_request_package_id, student_id)
);

comment on table public.enrollment_request_package_members is
  'The OTHER children a shared package line is to be shared with — never the student the enrollment request is for, who is added as a member at confirm time because a new student has no id until then (2026-09-12).';

create index if not exists idx_enrollment_request_package_members_student_id
  on public.enrollment_request_package_members (student_id);

alter table public.enrollment_request_package_members enable row level security;

grant select, insert, update, delete on public.enrollment_request_package_members
  to authenticated, service_role;

-- Same gate as the line items themselves: this is admin-only intake data. A
-- parent paying an invoice never reads these tables — `submit-payment-proof`
-- runs as `service_role` on their behalf.
drop policy if exists "admin_all_enrollment_request_package_members" on public.enrollment_request_package_members;
create policy "admin_all_enrollment_request_package_members" on public.enrollment_request_package_members
  for all using (public.is_admin()) with check (public.is_admin());

-- The same two rules the shared-package triggers enforce on the real thing,
-- applied at intake so a request that could never be confirmed is refused when
-- it is written rather than after the family has paid:
--   * a shared line's course type must be shareable
--   * a co-sharer must not be the student the request is already for
create or replace function public.validate_enrollment_request_package_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shareable boolean;
  ct_name text;
begin
  if not new.is_shared then return new; end if;
  select ct.is_shareable, ct.name into shareable, ct_name
    from public.course_types ct where ct.id = new.course_type_id;
  if not coalesce(shareable, false) then
    raise exception '% is bought per student and cannot be sold as a shared package.',
      coalesce(ct_name, 'Course type ' || new.course_type_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_enrollment_request_package_share on public.enrollment_request_packages;
create trigger trg_validate_enrollment_request_package_share
  before insert or update of is_shared, course_type_id on public.enrollment_request_packages
  for each row execute function public.validate_enrollment_request_package_share();

create or replace function public.validate_enrollment_request_package_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  line_is_shared boolean;
  request_student_id text;
begin
  select erp.is_shared, er.student_id into line_is_shared, request_student_id
    from public.enrollment_request_packages erp
    join public.enrollment_requests er on er.id = erp.enrollment_request_id
    where erp.id = new.enrollment_request_package_id;
  if not found then
    raise exception 'Enrollment request package line % does not exist.', new.enrollment_request_package_id;
  end if;
  if not coalesce(line_is_shared, false) then
    raise exception 'Package line % is not shared; only a shared line has co-sharers.',
      new.enrollment_request_package_id;
  end if;
  if request_student_id is not null and request_student_id = new.student_id then
    raise exception 'Student % is the one this request is for and is already a member — store only the OTHER child.',
      new.student_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_enrollment_request_package_member on public.enrollment_request_package_members;
create trigger trg_validate_enrollment_request_package_member
  before insert or update on public.enrollment_request_package_members
  for each row execute function public.validate_enrollment_request_package_member();

grant execute on function public.validate_enrollment_request_package_share() to authenticated, service_role;
grant execute on function public.validate_enrollment_request_package_member() to authenticated, service_role;
