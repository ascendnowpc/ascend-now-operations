-- Some billable sessions carry no subject, only a program type — most
-- notably College Counselling, whose sessions are logged under the
-- "College Counselling" / "College Essays" programs with no subject at all.
-- Those lines were rendering as a bare "—" on reports. Recording the program
-- type on each line lets a report label such rows by their program name (and
-- split College Counselling vs College Essays) instead of an anonymous dash.
-- Nullable: a normal subject-based line simply leaves it null and is still
-- labeled by its subject.

ALTER TABLE public.invoice_line_items
  ADD COLUMN program_type_id smallint REFERENCES public.program_types(id);
