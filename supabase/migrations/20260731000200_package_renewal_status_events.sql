-- Per-package renewal/upsell status, with a dated change history.
--
-- Supersedes the aggregate, whole-log automation from
-- 20260731000100_coordinator_logs_auto_renewal_upsell.sql. A student can hold
-- several packages/pools at once, each at a different point in its lifecycle, so
-- a single per-student renewal status was lossy. This tracks renewal + upsell
-- state **per package/pool**, and every time a package's state changes the
-- system appends a new dated row — so the coordinator-log view can show, per
-- package, the current status *and* exactly when each change happened.
--
-- These values are never entered by a PC/admin (removed from the log form) —
-- they're derived from the same signals that fire the milestone emails
-- (student_packages.notified_75/100_pct_at) plus package_renewal_requests.
--
-- Applied live via Supabase MCP apply_migration; kept here in dependency order.

-- --- 1. Drop the old aggregate whole-log automation --------------------------
drop trigger if exists trg_sync_coordinator_log_on_threshold on public.student_packages;
drop trigger if exists trg_sync_coordinator_log_on_renewal_request on public.package_renewal_requests;
drop function if exists public.trg_coordinator_log_on_package_threshold();
drop function if exists public.trg_coordinator_log_on_renewal_request();
drop function if exists public.sync_coordinator_log_for_student(text);

-- --- 2. Per-package status history table -------------------------------------
create table public.package_renewal_status_events (
  id bigint generated always as identity primary key,
  student_id text not null references public.students(id),
  student_package_id bigint not null references public.student_packages(id) on delete cascade,
  course_type_id smallint references public.course_types(id),
  package_type_id smallint references public.course_types(id),
  pool_label text,
  renewal_status text not null check (renewal_status in ('not_due','upcoming','in_discussion','renewed','not_renewing')),
  upsell_opportunity text not null check (upsell_opportunity in ('none','low','medium','high')),
  recommended boolean not null default false,
  upsell_timing date,
  event_date date not null default current_date,
  created_at timestamptz not null default now()
);

comment on table public.package_renewal_status_events is
  'Append-only per-package renewal/upsell status history. One row is added (by record_package_renewal_status(), fired from student_packages/package_renewal_requests triggers) each time a package''s derived renewal_status/upsell_opportunity/recommended/upsell_timing changes, so the coordinator-log view shows current status per package plus the dated history of what changed when. Never written by a PC/admin.';

create index package_renewal_status_events_student_id_idx on public.package_renewal_status_events(student_id);
create index package_renewal_status_events_student_package_id_idx on public.package_renewal_status_events(student_package_id);

alter table public.package_renewal_status_events enable row level security;

-- Same access model as coordinator_logs: admin everywhere, a PC only for their
-- currently-assigned students. Inserts only ever happen through the SECURITY
-- DEFINER trigger function below, so no INSERT policy is needed for users.
create policy "Admins can read all package_renewal_status_events"
  on public.package_renewal_status_events for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "PCs can read assigned package_renewal_status_events"
  on public.package_renewal_status_events for select
  to authenticated
  using (
    public.is_performance_coach() and exists (
      select 1 from public.pc_student_assignments a
      where a.student_id = package_renewal_status_events.student_id
        and a.pc_teacher_id = public.my_teacher_id()
        and a.unassigned_at is null
    )
  );

grant select on table public.package_renewal_status_events to authenticated;
grant all on table public.package_renewal_status_events to service_role;

-- --- 3. Recompute + append-on-change function --------------------------------
create or replace function public.record_package_renewal_status(p_student_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  pkg record;
  v_has_open boolean;
  v_renewed_fresh boolean;
  v_status text;
  v_upsell text;
  v_recommended boolean;
  v_timing date;
  v_last record;
begin
  for pkg in
    select sp.id, sp.course_type_id, sp.package_type_id, sp.pool_label,
           sp.notified_75_pct_at, sp.notified_100_pct_at
    from public.student_packages sp
    where sp.student_id = p_student_id and sp.is_locked = false
  loop
    v_has_open := exists (
      select 1 from public.package_renewal_requests r
      where r.student_id = p_student_id
        and r.course_type_id = pkg.course_type_id
        and r.status in ('pending', 'acknowledged'));

    v_renewed_fresh := pkg.notified_75_pct_at is null and exists (
      select 1 from public.package_renewal_requests r
      where r.status = 'renewed'
        and r.resulting_student_package_id = pkg.id);

    if v_renewed_fresh then v_status := 'renewed'; v_upsell := 'high';
    elsif v_has_open then v_status := 'in_discussion'; v_upsell := 'medium';
    elsif pkg.notified_100_pct_at is not null then v_status := 'not_renewing'; v_upsell := 'low';
    elsif pkg.notified_75_pct_at is not null then v_status := 'upcoming'; v_upsell := 'low';
    else v_status := 'not_due'; v_upsell := 'none';
    end if;

    v_recommended := pkg.notified_75_pct_at is not null;
    v_timing := case when v_recommended then date_trunc('month', pkg.notified_75_pct_at)::date else null end;

    select renewal_status, upsell_opportunity, recommended, upsell_timing
    into v_last
    from public.package_renewal_status_events
    where student_package_id = pkg.id
    order by id desc
    limit 1;

    if not found
       or v_last.renewal_status is distinct from v_status
       or v_last.upsell_opportunity is distinct from v_upsell
       or v_last.recommended is distinct from v_recommended
       or v_last.upsell_timing is distinct from v_timing then
      insert into public.package_renewal_status_events (
        student_id, student_package_id, course_type_id, package_type_id, pool_label,
        renewal_status, upsell_opportunity, recommended, upsell_timing
      ) values (
        p_student_id, pkg.id, pkg.course_type_id, pkg.package_type_id, pkg.pool_label,
        v_status, v_upsell, v_recommended, v_timing
      );
    end if;
  end loop;
end;
$$;

comment on function public.record_package_renewal_status(text) is
  'Recomputes each unlocked package''s renewal/upsell status for a student from student_packages'' notified_75/100_pct_at flags and package_renewal_requests, and appends a dated package_renewal_status_events row for any package whose status changed since its last event.';

-- --- 4. Triggers — same events that email the coaches ------------------------
create or replace function public.trg_record_package_renewal_status_pkg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.record_package_renewal_status(new.student_id);
  return new;
end;
$$;

create trigger trg_prs_student_packages_ins
  after insert on public.student_packages
  for each row execute function public.trg_record_package_renewal_status_pkg();

create trigger trg_prs_student_packages_upd
  after update of notified_75_pct_at, notified_100_pct_at on public.student_packages
  for each row execute function public.trg_record_package_renewal_status_pkg();

create or replace function public.trg_record_package_renewal_status_req()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.record_package_renewal_status(new.student_id);
  return new;
end;
$$;

create trigger trg_prs_renewal_requests
  after insert or update on public.package_renewal_requests
  for each row execute function public.trg_record_package_renewal_status_req();

-- --- 5. Backfill a baseline event for every current package ------------------
do $$
declare s record;
begin
  for s in select id from public.students loop
    perform public.record_package_renewal_status(s.id);
  end loop;
end;
$$;
