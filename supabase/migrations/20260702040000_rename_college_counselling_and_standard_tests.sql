-- =========================================================
-- program_types.name was globally UNIQUE, which blocked naming the
-- "General Counselling" sub-program "College Counselling" like its parent
-- (see 20260702030000_standard_test_curriculum_college_counselling.sql).
-- Relax it to be unique per parent instead: a coalesce-based unique index
-- (rather than a plain UNIQUE(name, parent_id) constraint) so that
-- top-level rows (parent_id IS NULL) are still compared against each other
-- for uniqueness — a plain composite unique constraint would treat every
-- NULL parent_id as distinct and silently stop enforcing uniqueness among
-- top-level names entirely, which is not the intent here.
-- =========================================================
alter table public.program_types drop constraint program_types_name_key;

create unique index program_types_name_per_parent_key
  on public.program_types (name, coalesce(parent_id, -1));

-- Rename "General Counselling" -> "College Counselling" (now possible).
update public.program_types set name = 'College Counselling' where name = 'General Counselling';

-- Rename curriculum "Standard Test" -> "Standard Tests".
update public.curricula set name = 'Standard Tests' where name = 'Standard Test';
