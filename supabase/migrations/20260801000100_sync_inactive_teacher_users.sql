-- Fix teacher-deactivation not marking the linked user inactive, and backfill
-- the rows that predate the fix.
--
-- Root cause: prevent_self_privilege_escalation() (BEFORE UPDATE ON users)
-- only let the change through when auth.uid() belongs to an admin. The
-- deactivate-teacher-with-user edge function runs under the service role,
-- where auth.uid() is NULL, so its `users.update({ is_active: false })` was
-- silently rejected by the trigger. The net effect: deactivating a teacher
-- flipped teachers.is_active but left users.is_active = true, so those
-- accounts still showed as "Active" on /admin/users and the Inactive status
-- filter never matched anything.
--
-- The RLS on public.users already restricts UPDATE to admins (is_admin()) or a
-- user editing their own row (auth.uid() = id). An authenticated non-admin
-- therefore always reaches this trigger with a non-NULL auth.uid() equal to
-- their own id, and anon cannot pass the UPDATE policy at all — so
-- "auth.uid() IS NULL" here can only be a trusted backend/service-role
-- context. Allowing that case lets the edge function's sync take effect while
-- still blocking a non-admin from escalating their own role/is_active.

create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
as $function$
begin
  -- Trusted backend context (service role / migrations): auth.uid() is NULL.
  -- RLS already gates who can issue the UPDATE, so this cannot be a non-admin
  -- editing their own row.
  if auth.uid() is null then
    return new;
  end if;
  if exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  ) then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'Changing role is not allowed';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'Changing active status is not allowed';
  end if;
  return new;
end;
$function$;

-- Backfill: sync users.is_active for teachers deactivated before the fix
-- above. Only touches users whose sole teacher record is inactive; the
-- NOT EXISTS guard leaves a user active if they still have any active teacher
-- record.
update users u
set is_active = false
where u.is_active = true
  and exists (
    select 1 from teachers t
    where t.user_id = u.id and t.is_active = false
  )
  and not exists (
    select 1 from teachers t
    where t.user_id = u.id and t.is_active = true
  );
