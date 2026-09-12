-- Renewal tracking can see a shared pool (2026-09-12).
--
-- `coordinator_log_package_status_rows()` enumerated a student's packages as
-- `sp.student_id = p_student_id`, which is every package there was when it was
-- written. Since 2026-09-11 a pool can be owned by a parent instead, so a
-- shared Academic pool at 80% used showed up in NEITHER child's coordinator
-- log: not as Upcoming, not as In Discussion, not at all. The renewal
-- lifecycle a PC and an admin actually work from — flagged → invoiced →
-- confirmed → Renewed — simply skipped shared hours.
--
-- Both halves of that function now go through `student_package_ids()`, the
-- same single definition of "what may this student draw on" the session-log
-- router and RLS use. A shared pool therefore appears in the log of each of the
-- two children named on it, which is right: either of them running it down is
-- a reason to talk to that family about renewing.
--
-- The sync trigger needed the matching fix. It passed `new.student_id`, which
-- is NULL on a shared pool, so `sync_coordinator_log_for_student(null)` quietly
-- did nothing. It now fans out to the pool's members instead — and because a
-- brand-new shared pool has no members yet at INSERT time (they are written
-- immediately afterwards), naming a child on a pool is itself now a sync
-- trigger.

create or replace function public.coordinator_log_package_status_rows(p_student_id text)
returns table(
  student_package_id bigint,
  course_type_id smallint,
  package_type_id smallint,
  pool_label text,
  renewal_status text,
  renewal_timing date
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  pkg record;
  req record;
  v_has_open boolean;
  v_renewed_fresh boolean;
begin
  for pkg in
    select sp.id, sp.course_type_id, sp.package_type_id, sp.pool_label,
           sp.notified_75_pct_at, sp.notified_100_pct_at
    from public.student_packages sp
    where sp.id in (select public.student_package_ids(p_student_id))
      and sp.is_locked = false
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
    if v_renewed_fresh then renewal_status := 'renewed';
    elsif v_has_open then renewal_status := 'in_discussion';
    elsif pkg.notified_100_pct_at is not null then renewal_status := 'not_renewing';
    elsif pkg.notified_75_pct_at is not null then renewal_status := 'upcoming';
    else renewal_status := 'not_due';
    end if;
    renewal_timing := case when pkg.notified_75_pct_at is not null then date_trunc('month', pkg.notified_75_pct_at)::date else null end;
    return next;
  end loop;
  -- Phantom rows: still-open renewal requests for a package/bundle this
  -- student doesn't have yet at all (a genuinely new-package request), so
  -- "in discussion" has somewhere to show up even before any real package
  -- row exists to hang it off of. A shared pool the student is named on
  -- counts as having it, same as one of their own.
  for req in
    select distinct r.course_type_id
    from public.package_renewal_requests r
    where r.student_id = p_student_id
      and r.status in ('pending', 'acknowledged')
      and not exists (
        select 1 from public.student_packages sp
        where sp.id in (select public.student_package_ids(p_student_id))
          and sp.is_locked = false
          and (
            (sp.course_type_id = r.course_type_id and sp.package_type_id is null)
            or sp.package_type_id = r.course_type_id
          )
      )
  loop
    student_package_id := null;
    course_type_id := req.course_type_id;
    package_type_id := null;
    pool_label := null;
    renewal_status := 'in_discussion';
    renewal_timing := null;
    return next;
  end loop;
end;
$function$;

-- A package insert / threshold crossing syncs whoever the package belongs to:
-- its own student, or — for a shared pool, whose student_id is NULL — every
-- child named on it.
create or replace function public.trg_sync_coordinator_log_pkg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_student_id text;
begin
  if new.student_id is not null then
    perform public.sync_coordinator_log_for_student(new.student_id);
  else
    for v_student_id in
      select m.student_id from public.student_package_members m
      where m.student_package_id = new.id
    loop
      perform public.sync_coordinator_log_for_student(v_student_id);
    end loop;
  end if;
  return new;
end;
$function$;

-- Naming a child on a shared pool (or removing them) changes what that child's
-- renewal tracking should say, and is the only moment a brand-new shared pool
-- has anyone to sync at all — the pool is inserted before its members are.
create or replace function public.trg_sync_coordinator_log_pkg_member()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.sync_coordinator_log_for_student(coalesce(new.student_id, old.student_id));
  return coalesce(new, old);
end;
$function$;

drop trigger if exists trg_sync_coordinator_log_spm on public.student_package_members;
create trigger trg_sync_coordinator_log_spm
  after insert or delete on public.student_package_members
  for each row execute function public.trg_sync_coordinator_log_pkg_member();

grant execute on function public.trg_sync_coordinator_log_pkg_member() to authenticated, service_role;
