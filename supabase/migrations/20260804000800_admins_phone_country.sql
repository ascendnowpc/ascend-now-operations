-- Admins currently store no contact/location info at all (id, user_id,
-- created_at, updated_at only). Add the same two optional fields teachers
-- and performance coaches already collect on creation, so an admin's record
-- has the same shape for that info.

ALTER TABLE public.admins
  ADD COLUMN phone_number text,
  ADD COLUMN country text;
