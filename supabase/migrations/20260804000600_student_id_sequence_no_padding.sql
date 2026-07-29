-- Drop the zero-padding on the sequence portion of the mnemonic student id
-- added in 20260804000500 (BATO26-0001, BATO26-0002, ...) in favor of the
-- plain unpadded number (BATO26-1, BATO26-2, ...) — lpad() never actually
-- truncates past its width, but a fixed-width pad reads like an artificial
-- cap. CREATE OR REPLACE keeps the same function name, so the existing
-- trg_generate_student_id trigger (20260804000500) picks this up as-is.

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

  name_part := upper(left(regexp_replace(NEW.first_name, '[^A-Za-z]', '', 'g'), 3));
  name_part := rpad(name_part, 3, 'X');

  surname_part := upper(left(regexp_replace(NEW.last_name, '[^A-Za-z]', '', 'g'), 1));
  if surname_part = '' then
    surname_part := 'X';
  end if;

  NEW.id := name_part || surname_part || to_char(now(), 'YY') || '-' ||
            nextval('public.students_num_seq')::text;
  return NEW;
end;
$function$;
