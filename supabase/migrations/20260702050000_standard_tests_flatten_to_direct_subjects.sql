-- =========================================================
-- Drop the group concept for "Standard Tests" entirely — ACT/SAT/TOEFL/
-- IELTS become plain subjects directly under the curriculum (via
-- subjects.curriculum_id, curriculum_group_id left null), exactly like any
-- other subject, with no group-selection step in between. This replaces
-- the curriculum_groups approach from
-- 20260702030000_standard_test_curriculum_college_counselling.sql.
--
-- One real row already existed from testing the previous (group-based)
-- design: subject 601 "TOEFL" under curriculum_group_id 43, assigned to
-- teacher 142 (teacher_subjects.id 453, curriculum_id already 17). Re-point
-- it to curriculum_id/curriculum_group_id directly rather than recreating
-- it, so that existing assignment isn't disturbed.
-- =========================================================
update subjects
set curriculum_id = 17, curriculum_group_id = null
where id = 601;

insert into subjects (name, category, category_id, curriculum_id, is_active)
select v.name, 'academic', 1, 17, true
from (values ('ACT'), ('SAT'), ('IELTS')) as v(name);

delete from curriculum_groups where id in (41, 42, 43, 44);
