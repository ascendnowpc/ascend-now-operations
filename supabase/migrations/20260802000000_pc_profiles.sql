-- Performance Coach visual profile — the Canva-style "about me" card a PC
-- fills in at first login and maintains from /teacher/pc-profile, shown to each
-- of their assigned students on the student Overview tab ("Your Performance
-- Coach").
--
-- One row per coach (`teacher_id` unique). The rich, repeatable sections
-- (performing achievements, educator experience, coach responsibilities,
-- education) are jsonb since they're free-form ordered lists the coach edits
-- inline — same style as the Homework Generator's questions_json.
--
-- The optional profile photo lives in the new PUBLIC `pc-profiles` bucket
-- (students need to render it directly), so `photo_url` stores a full public
-- URL, like zoom-invoice files on the public `session-invoices` bucket.

-- ============================================================================
-- pc_profiles — a performance coach's public-facing visual profile
-- ============================================================================
create table public.pc_profiles (
  id bigint generated always as identity primary key,
  teacher_id bigint not null unique references public.teachers(id),
  -- Small badge above the name (e.g. "Management").
  department text,
  -- Subtitle under the name; defaults to the role name.
  headline text not null default 'Performance Coach',
  -- Full public URL into the `pc-profiles` bucket, or null for the initials
  -- fallback.
  photo_url text,
  -- The "Hi there! Here's a little bit about me…" intro paragraph(s).
  about text,
  -- Performing Achievements — [{ student_name, subject, institutions,
  -- score_before, score_after, score_scale, helped: text[] }].
  achievements jsonb not null default '[]'::jsonb,
  -- Educator Experience — text[] of bullet points.
  educator_experience jsonb not null default '[]'::jsonb,
  -- Performance Coach responsibilities (at Ascend Now) — text[] of bullets.
  coach_responsibilities jsonb not null default '[]'::jsonb,
  -- Education — text[] of degree lines.
  education jsonb not null default '[]'::jsonb,
  contact_email text,
  contact_phone text,
  -- Flipped true once the coach saves the first-login setup gate; drives
  -- pcProfileNeedsCompletion() the same way students'/teachers' gates work.
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pc_profiles is 'A performance coach''s public-facing visual profile (the Canva-style "about me" card), filled at first login and shown to their assigned students on the Overview tab.';

create index pc_profiles_teacher_id_idx on public.pc_profiles(teacher_id);

create trigger touch_pc_profiles_updated_at
  before update on public.pc_profiles
  for each row execute function public.touch_updated_at();

alter table public.pc_profiles enable row level security;

-- Admins can do anything.
create policy "Admins can manage all pc_profiles"
  on public.pc_profiles for all
  using (is_admin())
  with check (is_admin());

-- A coach owns their own row (create + edit).
create policy "Coaches manage their own pc_profile"
  on public.pc_profiles for all
  using (teacher_id = my_teacher_id())
  with check (teacher_id = my_teacher_id());

-- Any staff member (a row in teachers) can read every profile — matches how
-- the rest of the app lets staff read the teachers directory.
create policy "Staff can read all pc_profiles"
  on public.pc_profiles for select
  to authenticated
  using (exists (select 1 from public.teachers t where t.user_id = (select auth.uid())));

-- A student can read only the profile of a coach actively assigned to them.
create policy "Students read their assigned coach pc_profile"
  on public.pc_profiles for select
  to authenticated
  using (
    exists (
      select 1
      from public.pc_student_assignments a
      join public.students s on s.id = a.student_id
      where a.pc_teacher_id = pc_profiles.teacher_id
        and a.unassigned_at is null
        and s.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on table public.pc_profiles to authenticated;
grant all on table public.pc_profiles to service_role;
grant usage on sequence public.pc_profiles_id_seq to authenticated, service_role;

-- ============================================================================
-- pc-profiles storage bucket — a coach's profile photo (public)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('pc-profiles', 'pc-profiles', true)
on conflict (id) do nothing;

drop policy if exists "Admins manage pc profile photos" on storage.objects;
create policy "Admins manage pc profile photos"
  on storage.objects for all
  using (bucket_id = 'pc-profiles' and public.is_admin())
  with check (bucket_id = 'pc-profiles' and public.is_admin());

-- Public bucket: anyone may read an object (students render it by URL).
drop policy if exists "Public read pc profile photos" on storage.objects;
create policy "Public read pc profile photos"
  on storage.objects for select
  using (bucket_id = 'pc-profiles');

-- Any staff member (a teachers row) can upload / replace / remove a photo.
drop policy if exists "Staff upload pc profile photos" on storage.objects;
create policy "Staff upload pc profile photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pc-profiles'
    and exists (select 1 from public.teachers t where t.user_id = (select auth.uid()))
  );

drop policy if exists "Staff update pc profile photos" on storage.objects;
create policy "Staff update pc profile photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'pc-profiles'
    and exists (select 1 from public.teachers t where t.user_id = (select auth.uid()))
  );

drop policy if exists "Staff delete pc profile photos" on storage.objects;
create policy "Staff delete pc profile photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pc-profiles'
    and exists (select 1 from public.teachers t where t.user_id = (select auth.uid()))
  );
