-- The 2026-07-02 "flattening" of Beyond Academic subject picking (see
-- 20260702100000_add_career_exploration_subject_category.sql) only removed
-- the forced two-click "Section then Subject" UI step -- the data model
-- still grouped subjects under a "Passion Projects" / "Career Exploration"
-- section via subjects.category_id, shown as an <optgroup> label. That's
-- still a hierarchy, and the actual requirement is no hierarchy at all:
-- Passion Projects and Career Exploration should themselves be pickable
-- subjects, sitting flat alongside Book Publishing, Finance and Literacy,
-- Podcast, etc. -- not headers grouping them.

-- Detach every currently-active Beyond Academic subject from its category
-- so nothing is grouped any more.
UPDATE public.subjects SET category_id = NULL WHERE category_id IN (3, 7);

-- Promote "Passion Projects" and "Career Exploration" from category labels
-- to real, directly pickable subjects (category='beyond_academic' matches
-- the loose `category !== 'academic'` check the frontend already uses to
-- decide "is this a beyond-academic subject").
INSERT INTO public.subjects (name, category, category_id, sort_order, is_active)
VALUES
  ('Passion Projects', 'beyond_academic', NULL, 0, true),
  ('Career Exploration', 'beyond_academic', NULL, 1, true);

-- The categories now group nothing and no longer drive any UI grouping --
-- deactivate them like the other legacy categories (Computer Science,
-- Communication skills, College Support, music) rather than leaving them
-- as dead active rows.
UPDATE public.subject_categories SET is_active = false WHERE id IN (3, 7);
