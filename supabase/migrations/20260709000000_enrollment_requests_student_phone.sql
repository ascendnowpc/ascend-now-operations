-- Real bug: `enrollment_requests.phone_number` was used for BOTH the new
-- student's own `students.phone_number` AND the parent's `parents.phone_number`
-- in review-enrollment-payment's new_student branch — one phone number typed
-- into the enroll form silently ended up duplicated onto both accounts,
-- exactly the "shared value" problem this whole feature (separate,
-- independently-collected student vs parent phone) was meant to fix. It only
-- ever got fixed for the *self-service* first-login flow, not for admin
-- enrollment itself.
--
-- `phone_number` keeps its existing meaning (parent/primary-contact phone —
-- already what the invoice and parent account use); this adds a genuinely
-- separate column for the student's own phone.
alter table public.enrollment_requests
  add column if not exists student_phone_number text;
