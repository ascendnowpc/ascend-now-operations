import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { NoShowSettings } from "../types/database";
import { getCached, setCached, invalidateCache } from "../lib/cache";

const CACHE_KEY = "noShowSettings";

// Single-row table — the rate paid to a teacher for a No Show 2 or No Show +.
export function useNoShowSettings() {
  const [settings, setSettings] = useState<NoShowSettings | null>(() => getCached<NoShowSettings>(CACHE_KEY) ?? null);
  const [loading, setLoading] = useState(!getCached(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (force = false) => {
    const cached = getCached<NoShowSettings>(CACHE_KEY);
    if (cached && !force) {
      setSettings(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.from("no_show_settings").select("*").eq("id", 1).single();
    if (error) {
      setError(error.message);
    } else {
      const row = data as NoShowSettings;
      setCached(CACHE_KEY, row);
      setSettings(row);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function updatePayoutAmount(payoutAmount: number, updatedByUserId: string) {
    const { data, error } = await supabase
      .from("no_show_settings")
      .update({ payout_amount: payoutAmount, updated_at: new Date().toISOString(), updated_by_user_id: updatedByUserId })
      .eq("id", 1)
      .select()
      .single();
    if (!error && data) {
      invalidateCache(CACHE_KEY);
      setSettings(data as NoShowSettings);
    }
    return { data: data as NoShowSettings | null, error: error?.message ?? null };
  }

  return { settings, loading, error, refetch, updatePayoutAmount };
}
