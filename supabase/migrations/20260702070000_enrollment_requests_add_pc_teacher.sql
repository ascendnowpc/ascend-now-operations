-- Every student in this system must have an assigned Performance Coach
-- (enforced today via the AdminStudentsPage UI and pc_student_assignments'
-- "one active coach per student" index). The new-student enrollment flow
-- needs to capture that choice up front so confirm-enrollment can create
-- the pc_student_assignments row at the same time it creates the student.
-- Not required for renewals, since the student already has one.

ALTER TABLE public.enrollment_requests ADD COLUMN pc_teacher_id bigint REFERENCES public.teachers(id);

ALTER TABLE public.enrollment_requests
  ADD CONSTRAINT enrollment_requests_new_student_needs_pc
  CHECK (enrollment_type = 'renewal' OR pc_teacher_id IS NOT NULL);
