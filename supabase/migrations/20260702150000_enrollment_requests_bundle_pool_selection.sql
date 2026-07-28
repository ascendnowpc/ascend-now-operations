-- A bundle course type (Foundation Program / All-In-One) fans out into
-- several labeled pools. Previously confirming any bundle enrollment
-- request recreated/topped-up *every* one of the bundle's pools using its
-- hardcoded default hours -- correct for a first-time purchase (nothing
-- exists yet, so the whole set has to be created), but wrong for a renewal:
-- topping up an already-owned bundle should add hours to exactly the one
-- pool the admin picked (e.g. "Extra Hours" ran low), not silently refill
-- every pool in the bundle again.
--
-- These columns let the enroll form record that choice. NULL/false (the
-- default) means "no specific pool" -- used for a genuine first-time bundle
-- purchase, where the confirm step still creates the full set. When
-- is_bundle_pool_selection is true, bundle_pool_label identifies exactly
-- one of the bundle's pool definitions (matched by label against
-- BUNDLE_POOL_DEFS in the review-enrollment-payment edge function) that
-- alone receives enrollment_requests.hours -- bundle_pool_label can itself
-- be NULL, since a bundle's default/unlabeled pool is a valid choice; the
-- boolean is what distinguishes "no selection" from "the unlabeled pool
-- was selected".

ALTER TABLE public.enrollment_requests
  ADD COLUMN is_bundle_pool_selection boolean NOT NULL DEFAULT false,
  ADD COLUMN bundle_pool_label text;
