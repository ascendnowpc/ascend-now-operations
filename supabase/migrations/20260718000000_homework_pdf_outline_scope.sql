-- Homework Generator: PDF chapter/section indexing (auto-index with Gemini).
--
-- Lets a teacher upload a book/notes PDF, have it indexed into a chapter ->
-- section outline, and generate homework scoped to just one chapter or section
-- instead of the whole document.
--
-- content_uploads gains an `outline` (the extracted chapter/section tree with
-- page ranges) plus its own status/error columns, mirroring the existing
-- parse_status/parse_error pair — outline extraction is a separate async job
-- (the `index-content-upload` edge function) from generation-time consumption.
--
-- generated_papers gains `content_scope`: null = use the whole document (current
-- behaviour), otherwise { label, page_start, page_end } naming the chapter/section
-- the questions must be drawn from. The generation function passes this to Gemini
-- as a "only use these pages" instruction.

alter table public.content_uploads
  add column if not exists outline jsonb,
  add column if not exists outline_status text not null default 'pending',
  add column if not exists outline_error text;

-- outline_status mirrors parse_status' allowed values.
alter table public.content_uploads
  drop constraint if exists content_uploads_outline_status_check;
alter table public.content_uploads
  add constraint content_uploads_outline_status_check
  check (outline_status in ('pending', 'processing', 'completed', 'failed'));

alter table public.generated_papers
  add column if not exists content_scope jsonb;

comment on column public.content_uploads.outline is
  'Extracted chapter->section outline for a PDF upload: { chapters: [{ title, page_start, page_end, sections: [{ title, page_start, page_end }] }] }. Null until the index-content-upload function runs.';
comment on column public.content_uploads.outline_status is
  'pending | processing | completed | failed — lifecycle of the outline-extraction job (separate from parse_status, which tracks generation-time consumption).';
comment on column public.generated_papers.content_scope is
  'Null = generate from the whole content source. Otherwise { label, page_start, page_end } naming the chapter/section of the uploaded PDF the questions must be drawn from.';
