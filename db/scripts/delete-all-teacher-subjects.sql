-- ============================================================================
-- Delete all teacher_subjects assignments
-- ============================================================================
-- Purpose: wipe out every teacher's subject assignments so they can be
-- re-added manually via the Admin > Teachers > Subjects UI using the
-- current Curriculum -> Subject Group -> Subject hierarchy.
--
-- This script does NOT attempt to re-map or reinsert the deleted rows
-- against the new hierarchy. Re-adding subjects must be done manually
-- (or via a separate script/UI) after running this.
--
-- Safe to re-run (idempotent: deleting an already-empty table is a no-op).
-- ============================================================================

delete from teacher_subjects;
