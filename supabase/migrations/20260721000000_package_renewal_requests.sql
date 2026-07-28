-- Package renewal requests: a Performance Coach flags that a specific
-- student needs their package renewed (course type + optional suggested
-- hours/label/note). Admin acknowledges it, and the system auto-marks it
-- "renewed" the moment a matching package top-up actually lands via the
-- existing enrollment/invoice flow (review-enrollment-payment) — no manual
-- "mark as done" step. Mirrors enrollment_requests' shape/conventions.

create table public.package_renewal_requests (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(id),
  course_type_id smallint not null references public.course_types(id),
  requested_hours numeric,
  package_size_label text,
  note text,
  requested_by_teacher_id bigint not null references public.teachers(id),
  status text not null default 'pending',
  acknowledged_by_user_id uuid references public.users(id),
  acknowledged_at timestamptz,
  resulting_student_package_id bigint references public.student_packages(id),
  renewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_renewal_requests_status_check
    check (status in ('pending', 'acknowledged', 'renewed')),
  constraint package_renewal_requests_requested_hours_check
    check (requested_hours is null or requested_hours > 0)
);

create index idx_package_renewal_requests_student_id on public.package_renewal_requests(student_id);
create index idx_package_renewal_requests_requested_by_teacher_id on public.package_renewal_requests(requested_by_teacher_id);
create index idx_package_renewal_requests_status on public.package_renewal_requests(status);
-- Looked up by (student_id, course_type_id, status) from review-enrollment-payment
-- every time a topup is confirmed, to auto-resolve matching requests.
create index idx_package_renewal_requests_student_course_status
  on public.package_renewal_requests(student_id, course_type_id, status);

create trigger trg_touch_package_renewal_requests_updated_at
  before update on public.package_renewal_requests
  for each row execute function public.touch_updated_at();

alter table public.package_renewal_requests enable row level security;

create policy "Admins can manage all renewal requests"
  on public.package_renewal_requests for all
  using (public.is_admin())
  with check (public.is_admin());

-- A PC can only ever submit a request as themselves, for a student
-- currently assigned to them — mirrors the pc_student_assignments scoping
-- used elsewhere (e.g. student_packages' PC policy).
create policy "PCs can submit renewal requests for their assigned students"
  on public.package_renewal_requests for insert
  to authenticated
  with check (
    public.is_performance_coach()
    and requested_by_teacher_id = public.my_teacher_id()
    and exists (
      select 1 from public.pc_student_assignments a
      where a.student_id = package_renewal_requests.student_id
        and a.pc_teacher_id = public.my_teacher_id()
        and a.unassigned_at is null
    )
  );

-- A PC can see their own submitted requests (any status) to track them —
-- not other coaches' requests.
create policy "PCs can view their own renewal requests"
  on public.package_renewal_requests for select
  to authenticated
  using (
    public.is_performance_coach()
    and requested_by_teacher_id = public.my_teacher_id()
  );

grant select, insert, update on public.package_renewal_requests to authenticated, service_role;
