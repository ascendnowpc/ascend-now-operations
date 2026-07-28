-- Coordinator Logs: a renewal request must not bleed into an unrelated bundle.
--
-- coordinator_log_package_status_rows() flagged a package "in_discussion" by
-- matching package_renewal_requests.course_type_id = student_packages.course_type_id
-- alone. A bundle pool (e.g. All-In-One's Beyond Academic pools) keeps its real
-- leaf course_type_id (Beyond Academic), with package_type_id pointing at the
-- bundle — so a renewal request a PC filed against the *standalone* "Beyond
-- Academic" course type (picked directly from the flat course-type dropdown,
-- deliberately not "All-In-One") matched every one of that student's All-In-One
-- Beyond Academic pools too, flipping all of them to "In Discussion" even though
-- the request had nothing to do with the bundle.
--
-- Fixed match: a request matches a package only when either (a) the request's
-- course_type_id is the package's own course_type_id AND the package isn't
-- part of any bundle, or (b) the request's course_type_id is the bundle the
-- package belongs to (package_type_id) — so a request against a leaf course
-- type only ever touches a standalone package of that type, and a request
-- against a bundle course type touches every pool in that bundle.
--
-- Applied live via Supabase MCP apply_migration; kept here in dependency order.

create or replace function public.coordinator_log_package_status_rows(p_student_id text)
returns table (
  student_package_id bigint,
  course_type_id smallint,
  package_type_id smallint,
  pool_label text,
  renewal_status text,
  upsell_opportunity text,
  upsell_timing date
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  pkg record;
  v_has_open boolean;
  v_renewed_fresh boolean;
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
        and r.status in ('pending', 'acknowledged')
        and (
          (r.course_type_id = pkg.course_type_id and pkg.package_type_id is null)
          or r.course_type_id = pkg.package_type_id
        ));
    v_renewed_fresh := pkg.notified_75_pct_at is null and exists (
      select 1 from public.package_renewal_requests r
      where r.status = 'renewed'
        and r.resulting_student_package_id = pkg.id);

    student_package_id := pkg.id;
    course_type_id := pkg.course_type_id;
    package_type_id := pkg.package_type_id;
    pool_label := pkg.pool_label;
    if v_renewed_fresh then renewal_status := 'renewed'; upsell_opportunity := 'high';
    elsif v_has_open then renewal_status := 'in_discussion'; upsell_opportunity := 'medium';
    elsif pkg.notified_100_pct_at is not null then renewal_status := 'not_renewing'; upsell_opportunity := 'low';
    elsif pkg.notified_75_pct_at is not null then renewal_status := 'upcoming'; upsell_opportunity := 'low';
    else renewal_status := 'not_due'; upsell_opportunity := 'none';
    end if;
    upsell_timing := case when pkg.notified_75_pct_at is not null then date_trunc('month', pkg.notified_75_pct_at)::date else null end;
    return next;
  end loop;
end;
$$;
