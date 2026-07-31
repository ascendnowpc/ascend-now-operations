-- Make the teachers → users.role sync aware of College Counsellors.
--
-- THE BUG: `sync_teacher_pc_role()` predates the CC role and only knew about
-- `is_performance_coach`. Its `else` branch forced `users.role = 'teacher'`,
-- so the AFTER INSERT trigger fired straight after `create-teacher-with-user`
-- had correctly created the account as `college_counselor` and overwrote it
-- back to `teacher`. Every CC ended up with the wrong login role.
--
-- Two visible consequences, both reported:
--   1. `/teacher/cc-students` is gated on `role = 'college_counselor'`, so a
--      counsellor clicking "My Students" was bounced back to /teacher.
--   2. The sidebar is picked from the login role first and the `teachers`
--      flags second (the flags are the fallback, because the role can only
--      carry one of PC/CC). With the role reading `teacher`, every navigation
--      rendered the plain-teacher sidebar for the moment before the teachers
--      row arrived, then snapped to the CC one.
--
-- The precedence below — PC, then CC, then plain teacher — is the same rule
-- `loginRoleForStaff()` in src/utils/staffRole.ts applies when the edge
-- function creates the account, so the trigger can no longer contradict it.
-- The trigger also has to watch BOTH columns now; watching only
-- `is_performance_coach` meant flipping `is_college_counselor` on an existing
-- teacher changed nothing.

create or replace function public.sync_teacher_staff_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if NEW.user_id is not null then
    update public.users
    set role = case
      when NEW.is_performance_coach then 'performance_coach'::public.user_role
      when NEW.is_college_counselor then 'college_counselor'::public.user_role
      else 'teacher'::public.user_role
    end
    where id = NEW.user_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_teacher_pc_role on public.teachers;
drop trigger if exists trg_sync_teacher_staff_role on public.teachers;

create trigger trg_sync_teacher_staff_role
  after insert or update of is_performance_coach, is_college_counselor
  on public.teachers
  for each row
  execute function public.sync_teacher_staff_role();

-- The old function is superseded; drop it so nothing can wire it back up.
drop function if exists public.sync_teacher_pc_role();

-- Backfill the counsellors already created with the wrong role. Scoped to
-- rows that actually disagree, so it can't touch anyone else.
update public.users u
set role = 'college_counselor'::public.user_role
from public.teachers t
where t.user_id = u.id
  and t.is_college_counselor
  and not t.is_performance_coach
  and u.role = 'teacher'::public.user_role;
