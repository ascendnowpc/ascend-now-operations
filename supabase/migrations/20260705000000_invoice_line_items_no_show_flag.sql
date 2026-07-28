-- Tracks whether an invoice line item's hours came from a No Show + session
-- rather than a completed one. No Show + still deducts the scheduled hour
-- from the student's package (see src/utils/noShow.ts), so it was already
-- included in invoice_line_items.hours/session_count — but with nothing to
-- distinguish it from a completed session once aggregated, student-facing
-- reports showed no-show hours as indistinguishable regular hours.
--
-- Application code (src/hooks/useInvoices.ts buildLineItems) now keys line
-- items by is_no_show too, so a no-show's hours are never merged into the
-- same line as a completed session for the same teacher/subject — each
-- stays its own row, letting reports (src/utils/buildInvoicePdf.ts,
-- ReportSectionsView) show no-show hours/sessions as a distinct, labeled
-- breakdown instead of silently folding them into "hours taught".
--
-- Existing invoice_line_items rows default to false (they predate this
-- distinction and can't be retroactively split); only newly generated
-- invoices pick this up, same caveat as the course_type_id/program_type_id
-- additions before this one.

alter table public.invoice_line_items
  add column is_no_show boolean not null default false;

comment on column public.invoice_line_items.is_no_show is
  'True when this line''s hours came from a No Show + session (the package still lost the hour, but no session actually took place) rather than a completed session. Kept as its own line (never merged with a completed-session line for the same teacher/subject) so reports can show no-show hours distinctly.';
