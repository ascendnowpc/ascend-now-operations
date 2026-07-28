import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { BundlePoolSetting } from "../types/database";
import { getCached, setCached, invalidateCache } from "../lib/cache";

const CACHE_KEY = "bundlePoolSettings";

export type BundlePoolDef = { label: string | null; courseTypeName: string; hours: number };

// Admin-editable hours for each Foundation Program / All-In-One pool (see
// bundle_pool_settings migration) — replaces what used to be a hardcoded
// BUNDLE_POOL_DEFS object duplicated in AdminEnrollStudentPage.tsx and the
// review-enrollment-payment edge function. Editing lives only in the Admin
// Reports "Settings" tab; every other consumer (the enroll preview) only reads.
export function useBundlePoolSettings() {
  const [settings, setSettings] = useState<BundlePoolSetting[]>(() => getCached<BundlePoolSetting[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(!getCached(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (force = false) => {
    const cached = getCached<BundlePoolSetting[]>(CACHE_KEY);
    if (cached && !force) {
      setSettings(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("bundle_pool_settings")
      .select("*")
      .order("bundle_name", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      const rows = (data ?? []) as BundlePoolSetting[];
      setCached(CACHE_KEY, rows);
      setSettings(rows);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function updateHours(id: number, hours: number, updatedByUserId: string) {
    const { data, error } = await supabase
      .from("bundle_pool_settings")
      .update({ hours, updated_at: new Date().toISOString(), updated_by_user_id: updatedByUserId })
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      invalidateCache(CACHE_KEY);
      setSettings((prev) => prev.map((row) => (row.id === id ? (data as BundlePoolSetting) : row)));
    }
    return { data: data as BundlePoolSetting | null, error: error?.message ?? null };
  }

  // Grouped the same shape the old hardcoded BUNDLE_POOL_DEFS was, keyed by
  // bundle_name, so AdminEnrollStudentPage's preview logic didn't need to change.
  const poolDefsByBundle: Record<string, BundlePoolDef[]> = {};
  for (const row of settings) {
    (poolDefsByBundle[row.bundle_name] ??= []).push({
      label: row.pool_label,
      courseTypeName: row.course_type_name,
      hours: row.hours,
    });
  }

  return { settings, poolDefsByBundle, loading, error, refetch, updateHours };
}
