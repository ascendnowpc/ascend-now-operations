-- Homework Generator — multi-page "parse an existing paper".
--
-- A teacher photographing a multi-page paper takes one photo per page. To parse
-- all of them into a single paper, a 'parsed' generated_papers row can now point
-- at several uploaded images instead of one. Rather than a join table, an ordered
-- array of content_uploads ids is stored on the paper (consistent with the other
-- jsonb/array-shaped columns here — blocks, content_scope); content_upload_id is
-- kept set to the FIRST element so the existing generated_papers_source_check
-- (which requires content_upload_id for 'parsed') and every single-file parsed
-- paper are untouched. No constraint change, additive column only.
alter table public.generated_papers
  add column if not exists content_upload_ids bigint[];

comment on column public.generated_papers.content_upload_ids is
  'Parsed papers only: ordered list of every uploaded page image when a paper was photographed across several images. Null for single-file parsed papers (use content_upload_id) and all non-parsed papers. content_upload_id stays set to the first element for the source-check constraint and back-compat.';
