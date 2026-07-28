-- Merge of the student & parent dashboards (2026-07-07).
--
-- Part 1 of 2 (additive only — safe to apply before the data purge and the
-- parent-removal migration that follows):
--   * students gains notification_email (the second "send updates to" email,
--     distinct from `email` which now creates the login), curriculum, an
--     optional report_card_url, and parent_phone_number (so the former
--     parent's phone survives on the merged single-record view now that the
--     separate `parents` table / parent login is going away).
--   * enrollment_requests gains the same notification_email / curriculum /
--     report_card_url so the intake form can capture them.
--   * a private `report-cards` storage bucket (admin-managed, staff-readable)
--     for the optional report-card upload.

alter table public.students
  add column if not exists notification_email  text,
  add column if not exists curriculum          text,
  add column if not exists report_card_url      text,
  add column if not exists parent_phone_number  text;

alter table public.enrollment_requests
  add column if not exists notification_email text,
  add column if not exists curriculum         text,
  add column if not exists report_card_url     text;

-- Private bucket for the optional report-card upload — same access shape as
-- payment-proofs (admins manage it; served to the browser via signed URLs),
-- plus a staff read so a performance coach can view it on the student detail
-- page.
insert into storage.buckets (id, name, public)
values ('report-cards', 'report-cards', false)
on conflict (id) do nothing;

drop policy if exists "Admins manage report cards" on storage.objects;
create policy "Admins manage report cards"
  on storage.objects for all
  using (bucket_id = 'report-cards' and public.is_admin())
  with check (bucket_id = 'report-cards' and public.is_admin());

drop policy if exists "Staff read report cards" on storage.objects;
create policy "Staff read report cards"
  on storage.objects for select
  using (bucket_id = 'report-cards' and exists (
    select 1 from public.teachers t where t.user_id = auth.uid()
  ));
