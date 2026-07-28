-- Remove program types no longer in use.
DELETE FROM public.program_types WHERE id IN (3, 10, 26); -- ECA/School collaboration, Others, Work for Ascend Now

-- Replace the old flat Offline Work children with the new two-track split:
-- Ascend Offline Work (no student, no package deduction) vs Student Offline
-- Work, itself split into Academic / Beyond Academic (student required,
-- deducts from that student's package).
DELETE FROM public.program_types WHERE id IN (11, 12, 13, 14);

INSERT INTO public.program_types (name, parent_id, type, is_active) VALUES
  ('Ascend Offline Work', 5, 'ascend_offline_work', true),
  ('Academic Offline Work', 5, 'academic_offline_work', true),
  ('Beyond Academic Offline Work', 5, 'beyond_academic_offline_work', true);
