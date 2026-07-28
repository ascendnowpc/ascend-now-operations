-- Lets a teacher reuse an already-generated paper (questions_json) for a
-- different student instead of generating fresh content — "clone" it into a
-- new draft row. content_source_type gains 'cloned' (no session_log/upload
-- FK required, since the clone doesn't derive from either of THIS student's
-- source material) and generated_papers gains cloned_from_paper_id for
-- provenance (shown on the review page banner).

alter table public.generated_papers
  add column cloned_from_paper_id bigint references public.generated_papers(id);

comment on column public.generated_papers.cloned_from_paper_id is 'Set when this paper was created by reusing another paper''s questions_json for a different student, instead of generating fresh content. References the source paper.';

alter table public.generated_papers
  drop constraint generated_papers_content_source_type_check;
alter table public.generated_papers
  add constraint generated_papers_content_source_type_check
  check (content_source_type in ('session_log', 'upload', 'both', 'cloned'));

alter table public.generated_papers
  drop constraint generated_papers_source_check;
alter table public.generated_papers
  add constraint generated_papers_source_check check (
    (content_source_type = 'session_log' and session_log_id is not null)
    or (content_source_type = 'upload' and content_upload_id is not null)
    or (content_source_type = 'both' and session_log_id is not null and content_upload_id is not null)
    or (content_source_type = 'cloned')
  );

create index generated_papers_cloned_from_paper_id_idx on public.generated_papers(cloned_from_paper_id) where cloned_from_paper_id is not null;
