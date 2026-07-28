-- Some curricula (ACT, SAT, TOEFL, IELTS) are single standardized exams with
-- no meaningful subject-group breakdown — unlike IBDP/IGCSE/etc. which have
-- many subjects worth grouping. Subjects previously could only be tied to a
-- curriculum indirectly via curriculum_group_id -> curriculum_groups.curriculum_id,
-- which meant a curriculum with zero groups could never have any subjects at
-- all. This adds a direct, nullable curriculum_id so a subject can attach to
-- a curriculum without needing a group in between.
--
-- Exactly one of (curriculum_group_id, curriculum_id) should be set for an
-- academic subject that belongs to a specific curriculum; both null means
-- "no specific curriculum" (the existing "Other" bucket).
ALTER TABLE public.subjects ADD COLUMN curriculum_id smallint REFERENCES public.curricula(id);
CREATE INDEX idx_subjects_curriculum_id ON public.subjects USING btree (curriculum_id);
