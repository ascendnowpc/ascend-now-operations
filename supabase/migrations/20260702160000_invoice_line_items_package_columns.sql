-- Reports (invoices) are sectioned by curriculum, which leaves everything
-- non-academic (Beyond Academic, College Counselling — no curriculum) dumped
-- under a single "No curriculum" heading, and gives no per-package /
-- per-pool breakdown at all. To section a report by course type / package
-- pool instead (so College Counselling shows as its own section and a
-- Foundation Program / All-In-One bundle shows each of its pools plus a
-- combined total), each invoice line item needs to record which package it
-- belongs to.
--
-- Both are nullable: existing line items (pre-dating these columns) and any
-- future line item built from a session that never had a package linked
-- fall back to a course-type / "Other" section at render time.

ALTER TABLE public.invoice_line_items
  ADD COLUMN student_package_id bigint REFERENCES public.student_packages(id),
  ADD COLUMN course_type_id smallint REFERENCES public.course_types(id);

CREATE INDEX idx_invoice_line_items_student_package_id ON public.invoice_line_items(student_package_id);
