-- Reverts 20260704000000_teachers_email_unique_active_only.sql. Letting a
-- new teacher claim a deactivated teacher's email created a real
-- inconsistency: reactivating the old account later would leave it with a
-- broken/parked login email while the real address now belongs to someone
-- else, with no way back. Not worth the convenience — email uniqueness on
-- teachers goes back to being global, matching the original design.

DROP INDEX IF EXISTS public.teachers_email_active_key;

ALTER TABLE public.teachers ADD CONSTRAINT teachers_email_key UNIQUE (email);
