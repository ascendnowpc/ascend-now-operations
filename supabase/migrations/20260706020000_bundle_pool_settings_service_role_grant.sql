-- review-enrollment-payment reads bundle_pool_settings via its service-role
-- client. The initial migration only granted authenticated (SELECT/UPDATE)
-- and relied on RLS for admin-only writes, but this project's service_role
-- does NOT bypass base table grants (see db/docs/VERIFIED_DATABASE_STATE.md
-- "Grants" section — the same gotcha has bitten several earlier edge
-- functions the first time they touched a new table). Without this, every
-- bundle purchase confirmation would fail with
-- "permission denied for table bundle_pool_settings".

GRANT SELECT ON TABLE public.bundle_pool_settings TO service_role;
