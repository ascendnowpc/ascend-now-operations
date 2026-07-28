-- Session duration is no longer typed in directly by whoever logs a session
-- (teacher or admin) — it now comes from a single admin-editable default,
-- the same single-row-settings pattern already used for no_show_settings
-- (see 20260704020000_no_show_payout_settings.sql). Default is 1 hour;
-- admins can change it without a code deploy, and it applies to every new
-- session log going forward (existing logged sessions keep whatever
-- duration they were saved with).

CREATE TABLE public.session_duration_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_duration_hrs numeric NOT NULL DEFAULT 1 CHECK (
    default_duration_hrs > 0 AND (default_duration_hrs * 4) = round(default_duration_hrs * 4)
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES public.users(id)
);

INSERT INTO public.session_duration_settings (id) VALUES (1);

ALTER TABLE public.session_duration_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage session_duration_settings" ON public.session_duration_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Any logged-in user can read session_duration_settings" ON public.session_duration_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT SELECT, UPDATE ON TABLE public.session_duration_settings TO authenticated;
