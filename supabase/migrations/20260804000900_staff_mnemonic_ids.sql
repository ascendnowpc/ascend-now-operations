-- Convert teachers.id and admins.id from bigint identity PKs to the same
-- mnemonic text format students use (20260804000500/000600), so every person
-- in the system is identified the same way.
--
--   teachers: RANW26-3   (3 letters of first_name + 1 of last_name + YY + seq)
--   admins:   ADM…       (derived from users.full_name — admins has no
--                         first_name/last_name of its own)
--
-- Existing rows KEEP their current numeric id as the sequence suffix (teacher
-- 3 -> RANW26-3), exactly like S1 -> BATO26-1. That makes the old->new map
-- trivially unique and means no row changes position.
--
-- This is a big change and is written defensively:
--   * teachers.id is referenced by 20 FK columns across 18 tables, and 41 RLS
--     policies in `public` reference teachers (most via my_teacher_id()).
--     Rather than hand-listing either, both are captured from the catalog,
--     dropped, and rebuilt verbatim from the captured definitions — so nothing
--     can be missed or silently reworded.
--   * my_teacher_id() (bigint -> text) is dropped BEFORE the column type
--     change and recreated after: it is a SQL function selecting teachers.id,
--     so leaving it in place across the change would leave it returning the
--     wrong type at runtime.
--   * Storage-schema policies were checked and reference teachers.user_id,
--     never teachers.id, so they do not depend on the column and are left
--     untouched.
--   * The whole thing is one transaction: any failure rolls back completely,
--     and RLS fails CLOSED in the interim (policies dropped = no access)
--     rather than open.

begin;

-- ---------------------------------------------------------------- sequences
-- Continue from the current max id so a new staff member never collides with
-- an existing converted row.
create sequence if not exists public.teachers_num_seq;
select setval('public.teachers_num_seq', coalesce((select max(id) from public.teachers), 0) + 1, false);

create sequence if not exists public.admins_num_seq;
select setval('public.admins_num_seq', coalesce((select max(id) from public.admins), 0) + 1, false);

-- ------------------------------------------------------------- old->new map
create table public._mig_teacher_id_map as
select
  t.id as old_id,
  upper(rpad(left(regexp_replace(t.first_name, '[^A-Za-z]', '', 'g'), 3), 3, 'X'))
  || coalesce(nullif(upper(left(regexp_replace(coalesce(t.last_name, ''), '[^A-Za-z]', '', 'g'), 1)), ''), 'X')
  || to_char(t.created_at, 'YY') || '-' || t.id::text as code
from public.teachers t;

create unique index on public._mig_teacher_id_map (old_id);
create unique index on public._mig_teacher_id_map (code);

create function public._mig_teacher_code(p_old bigint) returns text
language sql stable as $$ select code from public._mig_teacher_id_map where old_id = p_old $$;

create table public._mig_admin_id_map as
select
  a.id as old_id,
  upper(rpad(left(regexp_replace(split_part(coalesce(u.full_name, ''), ' ', 1), '[^A-Za-z]', '', 'g'), 3), 3, 'X'))
  || coalesce(nullif(upper(left(regexp_replace(split_part(coalesce(u.full_name, ''), ' ', 2), '[^A-Za-z]', '', 'g'), 1)), ''), 'X')
  || to_char(a.created_at, 'YY') || '-' || a.id::text as code
from public.admins a
left join public.users u on u.id = a.user_id;

create unique index on public._mig_admin_id_map (old_id);

-- Same helper-function indirection as the teacher map above: ALTER COLUMN's
-- USING expression cannot contain a subquery, but it can call a function that
-- performs the lookup.
create function public._mig_admin_code(p_old bigint) returns text
language sql stable as $$ select code from public._mig_admin_id_map where old_id = p_old $$;

-- ---------------------------------------------------------- capture policies
create table public._mig_policy_backup as
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public';

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from public._mig_policy_backup loop
    execute format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- --------------------------------------------------- drop dependent functions
drop function if exists public.my_teacher_id();
drop function if exists public.create_teacher_profile(uuid, text, text[]);

-- --------------------------------------------------------- capture + drop FKs
create table public._mig_teacher_fk_backup as
select con.conname::text as conname,
       con.conrelid::regclass::text as tbl,
       pg_get_constraintdef(con.oid) as def,
       att.attname::text as col
from pg_constraint con
join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
where con.contype = 'f' and con.confrelid = 'public.teachers'::regclass;

do $$
declare r record;
begin
  for r in select * from public._mig_teacher_fk_backup loop
    execute format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  end loop;
end $$;

-- ------------------------------------------------------------- convert types
alter table public.teachers alter column id drop identity if exists;
alter table public.teachers alter column id type text using public._mig_teacher_code(id);

do $$
declare r record;
begin
  for r in select * from public._mig_teacher_fk_backup loop
    execute format('ALTER TABLE %s ALTER COLUMN %I TYPE text USING public._mig_teacher_code(%I)',
                   r.tbl, r.col, r.col);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select * from public._mig_teacher_fk_backup loop
    execute format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.conname, r.def);
  end loop;
end $$;

alter table public.admins alter column id drop identity if exists;
alter table public.admins alter column id type text using public._mig_admin_code(id);

-- -------------------------------------------------------- recreate functions
create or replace function public.my_teacher_id()
 returns text
 language sql
 stable security definer
as $function$
  select id from public.teachers
  where user_id = auth.uid()
  limit 1;
$function$;

create or replace function public.create_teacher_profile(p_user_id uuid, p_country text, p_subjects text[])
 returns text
 language plpgsql
 security definer
as $function$
declare
    v_teacher_id text;
    v_subject text;
begin
    insert into teachers (user_id, first_name, last_name, country, email, phone_number)
    select
        p_user_id,
        u.full_name,   -- simplest for now; split into first/last later if needed
        null,
        p_country,
        u.email,
        null
    from public.users u
    where u.id = p_user_id
    returning id into v_teacher_id;
    foreach v_subject in array p_subjects
    loop
        insert into teacher_subjects (teacher_id, subject_name)
        values (v_teacher_id, v_subject)
        on conflict (teacher_id, subject_name) do nothing;
    end loop;
    return v_teacher_id;
end;
$function$;

-- sync_coordinator_log_for_student declares `v_pc_id bigint` to hold
-- pc_student_assignments.pc_teacher_id, which is now text. Retype that one
-- declaration in place rather than restating the whole body here, so the rest
-- of the function stays exactly as it is today.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'sync_coordinator_log_for_student';

  if def is null then
    raise exception 'sync_coordinator_log_for_student not found';
  end if;
  if position('v_pc_id bigint' in def) = 0 then
    raise exception 'expected "v_pc_id bigint" declaration not found — aborting rather than guessing';
  end if;

  execute replace(def, 'v_pc_id bigint', 'v_pc_id text');
end $$;

-- --------------------------------------------------------- restore policies
do $$
declare r record; stmt text; role_list text;
begin
  for r in select * from public._mig_policy_backup loop
    select string_agg(quote_ident(x), ', ') into role_list from unnest(r.roles) x;

    stmt := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                   r.policyname, r.schemaname, r.tablename,
                   case when r.permissive = 'PERMISSIVE' then 'PERMISSIVE' else 'RESTRICTIVE' end,
                   r.cmd,
                   coalesce(role_list, 'public'));

    if r.qual is not null then
      stmt := stmt || format(' USING (%s)', r.qual);
    end if;
    if r.with_check is not null then
      stmt := stmt || format(' WITH CHECK (%s)', r.with_check);
    end if;

    execute stmt;
  end loop;
end $$;

-- Every captured policy must come back — otherwise a table silently loses its
-- access rules. Fail the whole migration if the counts don't match.
do $$
declare expected int; actual int;
begin
  select count(*) into expected from public._mig_policy_backup;
  select count(*) into actual from pg_policies where schemaname = 'public';
  if expected <> actual then
    raise exception 'policy restore mismatch: expected %, got %', expected, actual;
  end if;
end $$;

-- ------------------------------------------------- id generation for new rows
create or replace function public.generate_teacher_id()
 returns trigger
 language plpgsql
as $function$
declare
  name_part text;
  surname_part text;
begin
  if NEW.id is not null then
    return NEW;
  end if;

  name_part := upper(left(regexp_replace(NEW.first_name, '[^A-Za-z]', '', 'g'), 3));
  name_part := rpad(name_part, 3, 'X');

  surname_part := upper(left(regexp_replace(coalesce(NEW.last_name, ''), '[^A-Za-z]', '', 'g'), 1));
  if surname_part = '' then
    surname_part := 'X';
  end if;

  NEW.id := name_part || surname_part || to_char(now(), 'YY') || '-' ||
            nextval('public.teachers_num_seq')::text;
  return NEW;
end;
$function$;

create trigger trg_generate_teacher_id before insert on public.teachers
  for each row execute function public.generate_teacher_id();

-- admins has no first_name/last_name of its own — the name lives on the linked
-- users row (written by trg_create_user_profile from the Auth user_metadata,
-- which create-admin-with-user always sets), so derive from users.full_name.
create or replace function public.generate_admin_id()
 returns trigger
 language plpgsql
as $function$
declare
  full_name text;
  name_part text;
  surname_part text;
begin
  if NEW.id is not null then
    return NEW;
  end if;

  select u.full_name into full_name from public.users u where u.id = NEW.user_id;

  name_part := upper(left(regexp_replace(split_part(coalesce(full_name, ''), ' ', 1), '[^A-Za-z]', '', 'g'), 3));
  name_part := rpad(name_part, 3, 'X');

  surname_part := upper(left(regexp_replace(split_part(coalesce(full_name, ''), ' ', 2), '[^A-Za-z]', '', 'g'), 1));
  if surname_part = '' then
    surname_part := 'X';
  end if;

  NEW.id := name_part || surname_part || to_char(now(), 'YY') || '-' ||
            nextval('public.admins_num_seq')::text;
  return NEW;
end;
$function$;

create trigger trg_generate_admin_id before insert on public.admins
  for each row execute function public.generate_admin_id();

-- The new sequences back a text PK via trigger, so (per db/README.md's "one
-- rule to never forget") they need explicit USAGE — an INSERT grant on the
-- table is not enough for a non-identity sequence default.
grant usage on sequence public.teachers_num_seq to authenticated, service_role;
grant usage on sequence public.admins_num_seq to authenticated, service_role;

-- ------------------------------------------------------------------ cleanup
drop function public._mig_teacher_code(bigint);
drop function public._mig_admin_code(bigint);
drop table public._mig_teacher_id_map;
drop table public._mig_admin_id_map;
drop table public._mig_teacher_fk_backup;
drop table public._mig_policy_backup;

commit;
