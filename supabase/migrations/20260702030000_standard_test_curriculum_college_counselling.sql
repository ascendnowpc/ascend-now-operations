-- =========================================================
-- 1. Consolidate ACT/SAT/TOEFL/IELTS into a single "Standard Test"
--    curriculum, as groups under it (they were previously four separate,
--    group-less curricula). All four are currently empty (zero subjects,
--    zero teacher_subjects, zero session_logs/invoice_line_items rows
--    reference them — verified live before writing this migration), so
--    this is a pure structural move with nothing to backfill.
-- =========================================================
with new_curriculum as (
  insert into curricula (name, sort_order, is_active)
  values ('Standard Test', 6, true)
  returning id
)
insert into curriculum_groups (curriculum_id, name, sort_order, is_active)
select nc.id, g.name, g.sort_order, true
from new_curriculum nc
cross join (values ('ACT', 1), ('SAT', 2), ('TOEFL', 3), ('IELTS', 4)) as g(name, sort_order);

-- The four old standalone curricula are now fully superseded — safe to
-- remove outright (not just deactivate) since nothing references them.
delete from curricula where name in ('ACT', 'SAT', 'TOEFL', 'IELTS');

-- =========================================================
-- 2. Add "College Counselling" as a top-level program type with two
--    sub-programs. The second sub-program can't reuse the parent's exact
--    name ("College Counselling") because program_types.name is unique
--    across the whole table, so the general one is named "General
--    Counselling" instead.
-- =========================================================
with new_parent as (
  insert into program_types (name, type, parent_id, is_active)
  values ('College Counselling', 'college_counselling', null, true)
  returning id
)
insert into program_types (name, type, parent_id, is_active)
select v.name, v.type, np.id, true
from new_parent np
cross join (values
  ('General Counselling', 'college_counselling_general'),
  ('College Essays', 'college_essays')
) as v(name, type);

-- =========================================================
-- 3. "College Counselling" already exists as a course type (id 3, from the
--    original seed) but was left inactive — reactivate it so sessions
--    logged under the new program type bill against a real package
--    (session log forms resolve course_type_id by matching the top-level
--    program type's name, so the names must match exactly).
-- =========================================================
update course_types set is_active = true where name = 'College Counselling';

-- =========================================================
-- 4. Remove "College Support" from Beyond Academics — College Counselling
--    is now its own program type + course type/package, not a beyond-
--    academic subject section. Soft-deactivate (matches the app's own
--    "Remove section" action) rather than delete, so the 6 existing
--    subjects under it aren't destroyed — they're just hidden, and the
--    section can be reactivated from the Inactive tab if ever needed.
-- =========================================================
update subject_categories set is_active = false where name = 'College Support' and type = 'beyond_academic';
