-- College Counselling moves from a 2-level program_types hierarchy (parent
-- "College Counselling" id 31 with children "College Counselling" id 32 /
-- "College Essays" id 33) to a flat program_type + subjects pair, mirroring
-- Beyond Academics: the top-level program_types row (id 31) stays exactly as
-- it is, and its two former sub-programs become plain `subjects` rows
-- instead, picked from a new "College Counselling" tab in the Subjects
-- Library.
--
-- The two child program_types rows are deactivated, not deleted -- verified
-- live that zero session_logs reference them (ids 32/33), so this is safe,
-- but deactivating (rather than deleting) keeps the row available for any
-- historical FK that might still reference it and matches this repo's
-- existing soft-delete pattern for retired program/category rows.
--
-- course_types ("College Counselling") and bundle_pool_settings (the
-- unlabeled 40hr All-In-One College Counselling pool) are deliberately left
-- untouched -- packages/billing still treat College Counselling as one
-- whole course type with one bundle pool, exactly as before.
--
-- `subjects.category` is free text with no CHECK constraint; live data
-- already has three distinct non-academic values in use (beyond_academic,
-- passion_projects, profile_building), all picked via the generic
-- `category != 'academic'` check throughout the app. 'college_counselling'
-- is a new, distinct value so the two branches can be told apart.

UPDATE public.program_types SET is_active = false WHERE id IN (32, 33);

INSERT INTO public.subjects (name, category, category_id, is_active) VALUES
  ('College Counselling', 'college_counselling', NULL, true),
  ('College Essays',      'college_counselling', NULL, true);
