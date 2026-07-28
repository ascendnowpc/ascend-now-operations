-- Foundation Program / All-In-One are "bundle" course types — buying one
-- fans out into several labeled pools at once (e.g. All-In-One's "Primary
-- Project", "Secondary Project"), each with its own fixed hours. Those
-- hours used to live only as a hardcoded BUNDLE_POOL_DEFS object, byte-for-
-- byte duplicated in review-enrollment-payment/index.ts (authoritative —
-- actually creates the pools) and AdminEnrollStudentPage.tsx (preview
-- only), with a comment demanding the two stay in sync by hand. Moving
-- them into a table removes the duplication and makes the hours
-- admin-editable (Admin → Reports → Settings) without a code deploy.
--
-- One row per (bundle, pool) — not a single-row settings table like
-- no_show_settings/session_duration_settings, since a bundle has several
-- pools. course_type_name is which real course_type each pool bills
-- against (Beyond Academic / College Counselling), FK'd to course_types
-- by name (its natural key here, same as the code already keyed off).

CREATE TABLE public.bundle_pool_settings (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bundle_name text NOT NULL CHECK (bundle_name IN ('Foundation Program', 'All-In-One')),
  pool_label text,
  course_type_name text NOT NULL REFERENCES public.course_types(name) ON UPDATE CASCADE,
  hours numeric NOT NULL CHECK (hours > 0),
  sort_order smallint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES public.users(id)
);

-- A bundle can have at most one pool per label — including at most one
-- unlabeled ("default") pool, hence COALESCE rather than a plain UNIQUE
-- (which wouldn't dedupe multiple NULLs).
CREATE UNIQUE INDEX bundle_pool_settings_bundle_label_key
  ON public.bundle_pool_settings (bundle_name, COALESCE(pool_label, ''));

ALTER TABLE public.bundle_pool_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage bundle_pool_settings" ON public.bundle_pool_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Any logged-in user can read bundle_pool_settings" ON public.bundle_pool_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT SELECT, UPDATE ON TABLE public.bundle_pool_settings TO authenticated;

-- Seed with the exact values the old hardcoded BUNDLE_POOL_DEFS had.
INSERT INTO public.bundle_pool_settings (bundle_name, pool_label, course_type_name, hours, sort_order) VALUES
  ('Foundation Program', NULL,                  'Beyond Academic',    10, 1),
  ('Foundation Program', 'Discovery Project',    'Beyond Academic',    24, 2),
  ('All-In-One',         'Primary Project',      'Beyond Academic',    32, 1),
  ('All-In-One',         'Secondary Project',    'Beyond Academic',    24, 2),
  ('All-In-One',         'Extra Hours',          'Beyond Academic',    16, 3),
  ('All-In-One',         'Career Exploration',   'Beyond Academic',    10, 4),
  ('All-In-One',         NULL,                   'College Counselling', 40, 5);
