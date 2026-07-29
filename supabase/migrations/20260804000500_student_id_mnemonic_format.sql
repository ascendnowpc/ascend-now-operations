-- Student id becomes a mnemonic code instead of a bare sequence number.
--
-- Old:  'S' || nextval('students_num_seq')                    e.g. S1042
-- New:  first 3 letters of first_name + first letter of last_name
--       + 2-digit enrollment year + '-' + zero-padded nextval(students_num_seq)
--                                                               e.g. BATO26-0001
--
-- Still backed by the same students_num_seq for the actual uniqueness
-- guarantee — only the human-readable prefix changes. Moved from a column
-- DEFAULT to a BEFORE INSERT trigger because the new format needs
-- first_name/last_name from the same row being inserted, which a column
-- DEFAULT expression can't reference. The trigger only fires when NEW.id
-- is not already supplied, so an insert that does supply an explicit id
-- (e.g. a future seed/fixture row) is left untouched.

ALTER TABLE public.students ALTER COLUMN id DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.generate_student_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  name_part text;
  surname_part text;
begin
  if NEW.id is not null then
    return NEW;
  end if;

  -- Letters only, so a hyphenated/apostrophe'd/accented name never breaks
  -- the format; a name with fewer than 3 latin letters (or none at all)
  -- pads/falls back to 'X' rather than erroring — the trailing sequence
  -- number is what actually guarantees uniqueness, this part is just a
  -- human-readable hint.
  name_part := upper(left(regexp_replace(NEW.first_name, '[^A-Za-z]', '', 'g'), 3));
  name_part := rpad(name_part, 3, 'X');

  surname_part := upper(left(regexp_replace(NEW.last_name, '[^A-Za-z]', '', 'g'), 1));
  if surname_part = '' then
    surname_part := 'X';
  end if;

  NEW.id := name_part || surname_part || to_char(now(), 'YY') || '-' ||
            lpad(nextval('public.students_num_seq')::text, 4, '0');
  return NEW;
end;
$function$;

CREATE TRIGGER trg_generate_student_id BEFORE INSERT ON public.students FOR EACH ROW EXECUTE FUNCTION public.generate_student_id();
