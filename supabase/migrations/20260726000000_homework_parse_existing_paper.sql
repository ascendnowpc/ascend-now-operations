-- Homework Generator — parse an existing paper (upload a PDF/photo of a past
-- paper, Gemini extracts the questions verbatim + builds the answer key, no
-- new questions are generated). See db/docs/HOMEWORK_GENERATOR_ARCHITECTURE.md
-- "Parse an existing paper" section.
--
-- This schema change was already applied directly to the live project
-- (migration version 20260714035826) by a prior session that also deployed a
-- matching `parse-homework-paper` edge function, but never added either
-- one's source to the repo — invisible to the single-migration-system
-- convention this repo otherwise follows (see CLAUDE.md). Backfilled here
-- verbatim, plus supabase/functions/parse-homework-paper/index.ts, so the
-- repo matches reality again. This filename matches what the deployed
-- function's own header comment already assumed it would be called.
--
-- Two constraint relaxations, no new tables:
--   1. content_uploads.file_type — allow image types, so a teacher can upload a
--      photo/scan of a paper (jpg/jpeg/png/webp/heic), not just documents.
--   2. generated_papers — a new content_source_type 'parsed' whose source is an
--      uploaded file (content_upload_id required, like 'upload'); no session
--      log, no composition blocks, no style templates are involved.

-- 1. Allow image uploads alongside the existing document types.
alter table public.content_uploads
  drop constraint if exists content_uploads_file_type_check;
alter table public.content_uploads
  add constraint content_uploads_file_type_check
  check (file_type = any (array[
    'pdf'::text, 'ppt'::text, 'pptx'::text, 'docx'::text,
    'jpg'::text, 'jpeg'::text, 'png'::text, 'webp'::text, 'heic'::text
  ]));

-- 2a. Add 'parsed' to the allowed content_source_type values.
alter table public.generated_papers
  drop constraint if exists generated_papers_content_source_type_check;
alter table public.generated_papers
  add constraint generated_papers_content_source_type_check
  check (content_source_type = any (array[
    'session_log'::text, 'upload'::text, 'both'::text, 'cloned'::text, 'parsed'::text
  ]));

-- 2b. A 'parsed' paper is sourced from an uploaded file, so it requires a
--     content_upload_id (same rule as 'upload'); it never has a session log or
--     composition. Keep every existing branch intact and add the parsed one.
alter table public.generated_papers
  drop constraint if exists generated_papers_source_check;
alter table public.generated_papers
  add constraint generated_papers_source_check
  check (
    ((content_source_type = 'session_log'::text) and (session_log_id is not null))
    or ((content_source_type = 'upload'::text) and (content_upload_id is not null))
    or ((content_source_type = 'both'::text) and (session_log_id is not null) and (content_upload_id is not null))
    or (content_source_type = 'cloned'::text)
    or ((content_source_type = 'parsed'::text) and (content_upload_id is not null))
  );
