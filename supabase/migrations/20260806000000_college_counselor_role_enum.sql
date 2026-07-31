-- College Counsellor (CC) — step 1 of 2: the login role.
--
-- Split out from the rest of the CC work (20260806000100) because Postgres
-- will not let a newly added enum label be *used* in the same transaction it
-- was added in, and Supabase runs each migration in its own transaction.
-- Nothing here references the new label; 20260806000100 does.

alter type public.user_role add value if not exists 'college_counselor';
