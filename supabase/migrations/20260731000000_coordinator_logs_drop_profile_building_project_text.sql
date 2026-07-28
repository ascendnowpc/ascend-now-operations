-- The "Profile Building Project" is now expressed purely as the Beyond Academic
-- subjects selected on the log (stored in coordinator_log_subjects) — there is no
-- longer a free-text project field. No live row had a value here, so dropping is
-- lossless.
--
-- Applied live via Supabase MCP apply_migration.
alter table public.coordinator_logs
  drop column profile_building_project;
