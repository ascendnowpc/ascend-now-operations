-- Flattens the Offline Work hierarchy introduced in the previous migration:
-- the wrapping "Offline Work" top-level type added an extra dropdown step
-- that wasn't in the original design. Ascend Offline Work becomes its own
-- standalone top-level type (no sub-program needed), and Academic/Beyond
-- Academic Offline Work move under a new top-level "Student Offline Work"
-- group instead.

DO $$
DECLARE
  v_student_offline_id smallint;
BEGIN
  -- Promote Ascend Offline Work to a standalone top-level type.
  UPDATE public.program_types
  SET parent_id = NULL
  WHERE id = 27; -- Ascend Offline Work

  -- Create the new top-level "Student Offline Work" group.
  INSERT INTO public.program_types (name, parent_id, type, is_active)
  VALUES ('Student Offline Work', NULL, 'student_offline_work', true)
  RETURNING id INTO v_student_offline_id;

  -- Reparent Academic/Beyond Academic Offline Work under it.
  UPDATE public.program_types
  SET parent_id = v_student_offline_id
  WHERE id IN (28, 29); -- Academic Offline Work, Beyond Academic Offline Work

  -- The old "Offline Work" wrapper is now empty and unused — remove it.
  DELETE FROM public.program_types WHERE id = 5;
END $$;
