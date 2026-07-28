-- Every student is meant to have exactly one active performance coach at all
-- times (see db/docs/VERIFIED_DATABASE_STATE.md §2.3). As of 2026-07-01 only
-- 22 of 1000 students had an active pc_student_assignments row. This backs
-- everyone else onto a coach, round-robin across active performance coaches,
-- so the invariant holds going forward (new students are assigned at
-- creation time in the app — see AdminStudentsPage's "Add student" form).
--
-- Safe to re-run: only touches students with zero active assignment.
with pcs as (
  select id as pc_teacher_id, row_number() over (order by id) - 1 as pn
  from teachers
  where is_performance_coach and is_active
),
pc_count as (
  select count(*) as n from pcs
),
unassigned as (
  select s.id as student_id,
         row_number() over (order by s.id) - 1 as rn
  from students s
  where not exists (
    select 1 from pc_student_assignments a
    where a.student_id = s.id and a.unassigned_at is null
  )
)
insert into pc_student_assignments (student_id, pc_teacher_id)
select u.student_id, p.pc_teacher_id
from unassigned u
cross join pc_count c
join pcs p on p.pn = u.rn % c.n;
