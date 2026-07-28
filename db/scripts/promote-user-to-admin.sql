-- =========================================================
-- UTILITY: promote an existing user to admin
-- =========================================================
-- Use this after creating a user's login account (via Supabase
-- Dashboard > Authentication > Users > Create user, or via
-- create-admin.mjs) when you want to make them an admin.
--
-- Replace 'CHANGE_ME@example.com' below with the real email.
-- =========================================================

-- 1. Promote to admin role
update public.users
set role = 'admin'
where email = 'CHANGE_ME@example.com';

-- 2. Create the matching admins row
select public.create_admin_profile(
    (select id from public.users where email = 'CHANGE_ME@example.com')
);

-- 3. Confirm it worked
select u.id, u.email, u.username, u.role, a.id as admin_row_id
from public.users u
left join public.admins a on a.user_id = u.id
where u.email = 'CHANGE_ME@example.com';
