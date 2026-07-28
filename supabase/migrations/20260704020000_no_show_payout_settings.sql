-- No-show payout: teachers are paid a fixed amount for No Show 2 and No
-- Show + (No Show 1 has no effect on either party). The rate needs to be
-- admin-editable without a code deploy, so it lives in a single-row
-- settings table rather than a hardcoded constant.
--
-- monthly_report_teacher_stats gets two new columns to snapshot each
-- teacher's payable no-show count and the resulting payout amount at
-- report-generation time — same denormalized-snapshot pattern already used
-- for subject/curriculum names on the sibling stat tables, so a later rate
-- change never retroactively alters an already-generated or locked report.

CREATE TABLE public.no_show_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payout_amount numeric NOT NULL DEFAULT 30 CHECK (payout_amount >= 0),
  currency text NOT NULL DEFAULT 'SGD',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES public.users(id)
);

INSERT INTO public.no_show_settings (id) VALUES (1);

ALTER TABLE public.no_show_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage no_show_settings" ON public.no_show_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Any logged-in user can read no_show_settings" ON public.no_show_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT SELECT, UPDATE ON TABLE public.no_show_settings TO authenticated;

ALTER TABLE public.monthly_report_teacher_stats
  ADD COLUMN no_show_payable_count integer NOT NULL DEFAULT 0,
  ADD COLUMN no_show_payout_amount numeric NOT NULL DEFAULT 0;
