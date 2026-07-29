-- Make a teacher's last name compulsory.
--
-- Six teachers (Anugya, Bharat, Ylenia, Magdaleina, Jesse, Sajjad) were
-- created first-name-only back in 20260728120000/20260804000200, because the
-- client's session-log sheet only carried first names. Their real surnames
-- still aren't known, so per an explicit product decision the first name is
-- repeated into last_name rather than inventing a surname — these names render
-- on student dashboards and on invoice PDFs, so a made-up surname would put a
-- false name in front of students and paying customers.
--
-- Backfill first, then constrain. The CHECK is there because NOT NULL alone
-- would still accept an empty string, which defeats the point of "compulsory".

update public.teachers
set last_name = first_name
where last_name is null or btrim(last_name) = '';

alter table public.teachers alter column last_name set not null;

alter table public.teachers
  add constraint teachers_last_name_not_blank check (btrim(last_name) <> '');

-- create_teacher_profile() inserted a literal NULL last_name, which the
-- constraint above would now reject outright. Mirror the same
-- repeat-the-first-name convention used for the backfill so the function stays
-- callable. (This function is separately broken — it writes to
-- teacher_subjects.subject_name, a column that no longer exists — but that is
-- pre-existing and out of scope here; this only stops the NOT NULL from adding
-- a second, new failure mode.)
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
        u.full_name,
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
