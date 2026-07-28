-- Fixes a gap found while auditing the live database on 2026-07-01: the
-- `zoom_invoices` table had RLS policies assuming teachers could insert/read/
-- update their own rows ("Teachers can upload their own zoom invoices",
-- "Teachers can view their own zoom invoices", "Teachers can replace their
-- own pending zoom invoices" — see baseline migration section 11), but no
-- base GRANT existed for the `authenticated` role, so those policies could
-- never actually fire (same "RLS looks right but base grant missing"
-- pattern documented in db/README.md). Applied live via Supabase MCP and
-- mirrored here so the migration history matches what's live.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zoom_invoices TO authenticated;
