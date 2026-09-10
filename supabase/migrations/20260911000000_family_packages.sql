-- Family packages — a package bought once by a parent and drawn down by every
-- sibling (2026-09-11).
--
-- The problem: hours were owned by a student. A parent with two children who
-- bought 100 Academic hours for the family had to have them split into two
-- packages up front, and whichever child ran out first was stuck while the
-- other's balance sat unused. That is not how the hours were sold.
--
-- The model now: a package is owned by EXACTLY ONE of a student or a parent.
--   * parent-owned ("family") — every child linked to that parent deducts from
--     the same pool. This is what an admin creates from the parent's page.
--   * student-owned — unchanged, and still what every existing package is.
--     Nothing about them changes, and the enrollment flow keeps creating them.
--
-- Per-sibling attribution comes free and needs no new bookkeeping:
-- `session_logs.student_id` already says which child sat the session, and
-- `session_logs.student_package_id` already says which pool it came out of. The
-- colour-coded "who used what" breakdown is a GROUP BY over those two columns,
-- which is also why a student can be shown their sibling's TOTAL without being
-- shown a single one of their sibling's session logs (see
-- family_package_usage_by_student below).
--
-- `recompute_package_hours_used()` needs no change at all: it already sums
-- session_logs by student_package_id without caring whose student they are, so
-- two siblings drawing on one pool sum correctly as-is.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Ownership: student OR parent, never both, never neither
-- ─────────────────────────────────────────────────────────────────────────
alter table public.student_packages
  add column if not exists parent_id text references public.parents(id);

alter table public.student_packages
  alter column student_id drop not null;

-- Written as NOT VALID first and validated separately so the migration fails
-- loudly on any pre-existing row that violates it, rather than the ALTER
-- silently taking a long exclusive lock on a big table.
alter table public.student_packages
  drop constraint if exists student_packages_one_owner;
alter table public.student_packages
  add constraint student_packages_one_owner
  check (num_nonnulls(student_id, parent_id) = 1) not valid;
alter table public.student_packages validate constraint student_packages_one_owner;

create index if not exists idx_student_packages_parent_id
  on public.student_packages (parent_id) where parent_id is not null;

comment on column public.student_packages.parent_id is
  'Set when this is a FAMILY package: owned by the parent and drawn down by every one of their children. Mutually exclusive with student_id (student_packages_one_owner). Added 2026-09-11.';

-- The existing "one current pool per (student, course_type, pool_label)" index
-- stops constraining family rows the moment student_id goes null (Postgres
-- treats NULLs as distinct in a unique index), so a family pool needs its own
-- mirror of exactly the same rule.
create unique index if not exists student_packages_one_current_per_family_course_type
  on public.student_packages (parent_id, course_type_id, coalesce(pool_label, ''))
  where (not is_locked) and parent_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Which pools a student may draw on
-- ─────────────────────────────────────────────────────────────────────────
-- Their own, plus their family's. One definition, used by the session-log
-- trigger, by RLS, and by the usage RPC, so "what can this student spend"
-- cannot come to mean three different things.
create or replace function public.student_package_ids(p_student_id text)
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select sp.id
  from public.student_packages sp
  where sp.student_id = p_student_id
     or (sp.parent_id is not null
         and sp.parent_id = (select s.parent_id from public.students s where s.id = p_student_id));
$$;

comment on function public.student_package_ids(text) is
  'Every package a student may draw on: their own plus their family''s (2026-09-11).';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Session logs deduct from the family pool
-- ─────────────────────────────────────────────────────────────────────────
-- Same function as before with one change, applied in three places: the
-- candidate lookup, the sticky (teacher, subject) resolution, and the
-- pool_label direct match now consider the student's family pools alongside
-- their own. Everything else — the locked-package guards, the keep-the-existing
-- assignment shortcut, the ambiguity flag — is byte-for-byte what it was.
--
-- The zero-hour fallback pool deliberately stays STUDENT-owned: it exists to
-- make an overage visible against the right course type when no pool exists at
-- all, and inventing a family pool there would silently create shared hours
-- nobody bought.
create or replace function public.handle_session_log_package_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
DECLARE
  old_locked boolean := false;
  candidate_count int;
  resolved_pkg_id bigint;
  fallback_pkg_id bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.student_package_id IS NOT NULL THEN
      SELECT is_locked INTO old_locked FROM public.student_packages WHERE id = OLD.student_package_id;
    END IF;
    IF old_locked THEN
      RAISE EXCEPTION 'Cannot delete a session log belonging to a locked package.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.student_package_id IS NOT NULL THEN
    SELECT is_locked INTO old_locked FROM public.student_packages WHERE id = OLD.student_package_id;
    IF old_locked THEN
      RAISE EXCEPTION 'Cannot modify a session log belonging to a locked package.';
    END IF;
  END IF;
  -- A session that's already been resolved (deducted from a specific
  -- package) keeps that assignment on any later UPDATE, as long as the
  -- student/course_type it belongs to hasn't actually changed.
  IF TG_OP = 'UPDATE' AND OLD.student_package_id IS NOT NULL
     AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id
     AND NEW.course_type_id IS NOT DISTINCT FROM OLD.course_type_id
  THEN
    NEW.pool_ambiguous := false;
    RETURN NEW;
  END IF;
  NEW.pool_ambiguous := false;
  NEW.pool_fallback_used := false;
  IF NEW.student_id IS NULL OR NEW.course_type_id IS NULL THEN
    NEW.student_package_id := NULL;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO candidate_count
    FROM public.student_packages
    WHERE id IN (SELECT public.student_package_ids(NEW.student_id))
      AND course_type_id = NEW.course_type_id AND NOT is_locked;

  IF candidate_count = 1 THEN
    SELECT id INTO NEW.student_package_id
      FROM public.student_packages
      WHERE id IN (SELECT public.student_package_ids(NEW.student_id))
        AND course_type_id = NEW.course_type_id AND NOT is_locked;
  ELSIF candidate_count > 1 THEN
    -- 1. Sticky (teacher, subject) resolution first — an explicit,
    --    previously-recorded assignment always wins.
    IF NEW.teacher_id IS NOT NULL THEN
      SELECT r.student_package_id INTO resolved_pkg_id
        FROM public.session_log_pool_resolutions r
        JOIN public.student_packages sp ON sp.id = r.student_package_id
        WHERE r.student_id = NEW.student_id AND r.course_type_id = NEW.course_type_id
          AND r.teacher_id = NEW.teacher_id AND COALESCE(r.subject_id, -1) = COALESCE(NEW.subject_id, -1)
          AND NOT sp.is_locked;
    END IF;
    -- 2. Direct match: the session's own subject name exactly equals one of
    --    the candidate pools' pool_label — only when no resolution exists
    --    yet, so a brand-new session still resolves without a PC.
    IF resolved_pkg_id IS NULL AND NEW.subject_id IS NOT NULL THEN
      SELECT sp.id INTO resolved_pkg_id
        FROM public.student_packages sp
        JOIN public.subjects s ON s.id = NEW.subject_id
        WHERE sp.id IN (SELECT public.student_package_ids(NEW.student_id))
          AND sp.course_type_id = NEW.course_type_id
          AND NOT sp.is_locked AND sp.pool_label = s.name
        LIMIT 1;
    END IF;
    IF resolved_pkg_id IS NOT NULL THEN
      NEW.student_package_id := resolved_pkg_id;
    ELSE
      NEW.student_package_id := NULL;
      NEW.pool_ambiguous := true;
    END IF;
  ELSE
    -- No unlocked pool of this session's OWN course_type is available to this
    -- student at all — neither their own nor their family's. Never block the
    -- save, and never borrow a pool of a DIFFERENT course_type. Create a fresh
    -- zero-hour STUDENT-owned pool of the correct course_type so the overage is
    -- visible on the right package and the PC is notified.
    INSERT INTO public.student_packages (student_id, course_type_id, total_hours_purchased)
      VALUES (NEW.student_id, NEW.course_type_id, 0)
      RETURNING id INTO fallback_pkg_id;
    NEW.student_package_id := fallback_pkg_id;
    NEW.pool_fallback_used := true;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Who can see a family package
-- ─────────────────────────────────────────────────────────────────────────
-- The read gate for a package row, whichever way it is owned. SECURITY DEFINER
-- for the same reason can_view_student() is: it reads students/parents on the
-- caller's behalf, and going through a function keeps the policy from
-- subquerying those tables inline (the recursion class fixed on 2026-07-07).
create or replace function public.can_view_package(p_student_id text, p_parent_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_student_id is not null then public.can_view_student(p_student_id)
    when p_parent_id is not null then
      -- the parent themselves…
      exists (select 1 from public.parents p where p.id = p_parent_id and p.user_id = auth.uid())
      -- …or any of their children, who spend from this pool and must see it
      or exists (
        select 1 from public.students s
        where s.parent_id = p_parent_id and s.user_id = auth.uid()
      )
    else false
  end;
$$;

-- Staff equivalent: a coach reaches a family package through any of that
-- family's children who is on their roster.
create or replace function public.is_my_assigned_package(p_student_id text, p_parent_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_student_id is not null then public.is_my_assigned_student(p_student_id)
    when p_parent_id is not null then exists (
      select 1 from public.students s
      where s.parent_id = p_parent_id and public.is_my_assigned_student(s.id)
    )
    else false
  end;
$$;

drop policy if exists "student_parent_read_packages" on public.student_packages;
create policy "student_parent_read_packages" on public.student_packages
  for select using (public.can_view_package(student_id, parent_id));

drop policy if exists "pc_manage_assigned_packages" on public.student_packages;
create policy "pc_manage_assigned_packages" on public.student_packages
  for all
  using (public.is_coach_or_counselor() and public.is_my_assigned_package(student_id, parent_id))
  with check (public.is_coach_or_counselor() and public.is_my_assigned_package(student_id, parent_id));

-- Top-ups follow their package's visibility.
drop policy if exists "student_parent_read_topups" on public.package_topups;
create policy "student_parent_read_topups" on public.package_topups
  for select using (
    student_package_id in (
      select sp.id from public.student_packages sp
      where public.can_view_package(sp.student_id, sp.parent_id)
    )
  );

drop policy if exists "pc_select_own_topups" on public.package_topups;
create policy "pc_select_own_topups" on public.package_topups
  for select using (
    public.is_coach_or_counselor() and exists (
      select 1 from public.student_packages sp
      where sp.id = package_topups.student_package_id
        and public.is_my_assigned_package(sp.student_id, sp.parent_id)
    )
  );

drop policy if exists "pc_insert_own_topups" on public.package_topups;
create policy "pc_insert_own_topups" on public.package_topups
  for insert with check (
    public.is_coach_or_counselor() and exists (
      select 1 from public.student_packages sp
      where sp.id = package_topups.student_package_id
        and public.is_my_assigned_package(sp.student_id, sp.parent_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Who used the family's hours
-- ─────────────────────────────────────────────────────────────────────────
-- Per-sibling totals for a package, and nothing else. This is deliberately an
-- RPC rather than a client-side GROUP BY over session_logs, because a student
-- must be able to see that their sibling used 12 of the family's hours WITHOUT
-- being able to read a single one of that sibling's session logs — and RLS on
-- session_logs (rightly) shows a student only their own. Aggregating inside a
-- SECURITY DEFINER function is what lets the total out while the detail stays
-- in.
--
-- Same no-show rule as recompute_package_hours_used(): No Show 1 and 2 cost the
-- family nothing, No Show + costs the hour but is counted separately from
-- sessions, since nobody was taught.
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
  -- The RETURNS TABLE columns share names with columns on `students`
  -- (student_id/first_name/last_name). Everything below is table-qualified, but
  -- the pragma above settles it explicitly rather than relying on that.

  -- The caller must be able to see the package itself; otherwise this would be
  -- a way to read usage for any family by guessing an id.
  IF NOT (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.student_packages sp
      WHERE sp.id = p_package_id
        AND (public.can_view_package(sp.student_id, sp.parent_id)
             OR (public.is_coach_or_counselor()
                 AND public.is_my_assigned_package(sp.student_id, sp.parent_id)))
    )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.first_name,
    s.last_name,
    count(*) FILTER (WHERE sl.no_show_type IS NULL)::int,
    count(*) FILTER (WHERE sl.no_show_type IS NOT NULL)::int,
    COALESCE(SUM(sl.session_duration_hrs) FILTER (
      WHERE sl.no_show_type IS DISTINCT FROM 'no_show_1'
        AND sl.no_show_type IS DISTINCT FROM 'no_show_2'
    ), 0)::numeric
  FROM public.session_logs sl
  JOIN public.students s ON s.id = sl.student_id
  WHERE sl.student_package_id = p_package_id
  GROUP BY s.id, s.first_name, s.last_name
  ORDER BY s.id;
END;
$$;

comment on function public.family_package_usage_by_student(bigint) is
  'Per-sibling session/no-show/hour totals for one package. Aggregates inside SECURITY DEFINER so a student can see how much of a shared pool a sibling used without gaining any access to that sibling''s session logs (2026-09-11).';

grant execute on function public.student_package_ids(text) to authenticated, service_role;
grant execute on function public.can_view_package(text, text) to authenticated, service_role;
grant execute on function public.is_my_assigned_package(text, text) to authenticated, service_role;
grant execute on function public.family_package_usage_by_student(bigint) to authenticated, service_role;
