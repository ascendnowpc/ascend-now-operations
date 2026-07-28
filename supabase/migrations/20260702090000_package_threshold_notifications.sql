-- Tracks which usage-percentage thresholds (50/75/100%) a package has
-- already notified its Performance Coach about, so the notify-package-
-- threshold edge function (fired after each new session log) only emails
-- once per threshold rather than on every subsequent session.
ALTER TABLE public.student_packages
  ADD COLUMN notified_50_pct_at timestamptz,
  ADD COLUMN notified_75_pct_at timestamptz,
  ADD COLUMN notified_100_pct_at timestamptz;

-- A topup changes the denominator (total_hours_purchased), so a package
-- previously flagged as "100% notified" against the old total may no
-- longer even be near 100% of the new one — re-arm all three thresholds
-- whenever hours are added so they fire again against the new total.
CREATE OR REPLACE FUNCTION public.on_package_topup_inserted()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.student_packages
  SET
    total_hours_purchased = total_hours_purchased + NEW.hours_added,
    notified_50_pct_at    = NULL,
    notified_75_pct_at    = NULL,
    notified_100_pct_at   = NULL,
    updated_at            = now()
  WHERE id = NEW.student_package_id;
  RETURN NEW;
END;
$function$;
