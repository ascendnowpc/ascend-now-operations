import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { SessionDurationSettings } from "../types/database";
import { getCached, setCached, invalidateCache } from "../lib/cache";

const CACHE_KEY = "sessionDurationSettings";

// Single-row table — the default duration (hrs) applied to a new No Show +
// log (the one no-show type that still bills). A regular session log still
// lets the teacher/admin pick its own duration from a dropdown.
export function useSessionDurationSettings() {
  const [settings, setSettings] = useState<SessionDurationSettings | null>(() => getCached<SessionDurationSettings>(CACHE_KEY) ?? null);
  const [loading, setLoading] = useState(!getCached(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (force = false) => {
    const cached = getCached<SessionDurationSettings>(CACHE_KEY);
    if (cached && !force) {
      setSettings(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.from("session_duration_settings").select("*").eq("id", 1).single();
    if (error) {
      setError(error.message);
    } else {
      const row = data as SessionDurationSettings;
      setCached(CACHE_KEY, row);
      setSettings(row);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function updateDefaultDuration(defaultDurationHrs: number, updatedByUserId: string) {
    const { data, error } = await supabase
      .from("session_duration_settings")
      .update({ default_duration_hrs: defaultDurationHrs, updated_at: new Date().toISOString(), updated_by_user_id: updatedByUserId })
      .eq("id", 1)
      .select()
      .single();
    if (!error && data) {
      invalidateCache(CACHE_KEY);
      setSettings(data as SessionDurationSettings);
    }
    return { data: data as SessionDurationSettings | null, error: error?.message ?? null };
  }

  return { settings, loading, error, refetch, updateDefaultDuration };
}
