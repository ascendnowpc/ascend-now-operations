import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { CoordinatorLogOption, CoordinatorLogListKey } from "../types/database";
import { getCached, setCached, invalidateCache } from "../lib/cache";

// One hook backs all 6 admin-editable Coordinator Log dropdowns (Primary
// Goal, Progress Status, Biggest Challenge, Next Action, Renewal Status,
// Referral Status) — they're all the same shape (label/order/active) in the
// shared coordinator_log_options table, discriminated by listKey. Managed
// only from Admin -> Reports -> Settings (CoordinatorLogOptionListSection);
// every other consumer (the log form's dropdowns) only reads the active ones.
export function useCoordinatorLogOptions(listKey: CoordinatorLogListKey) {
  const cacheKey = `coordinatorLogOptions:${listKey}`;
  const [options, setOptions] = useState<CoordinatorLogOption[]>(() => getCached<CoordinatorLogOption[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(!getCached(cacheKey));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (force = false) => {
    const cached = getCached<CoordinatorLogOption[]>(cacheKey);
    if (cached && !force) {
      setOptions(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("coordinator_log_options")
      .select("*")
      .eq("list_key", listKey)
      .order("sort_order", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      const rows = (data ?? []) as CoordinatorLogOption[];
      setCached(cacheKey, rows);
      setOptions(rows);
      setError(null);
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, cacheKey]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const activeOptions = options.filter((o) => o.is_active);

  async function createOption(label: string, updatedByUserId: string) {
    const nextSortOrder = options.length > 0 ? Math.max(...options.map((o) => o.sort_order)) + 1 : 0;
    const { data, error } = await supabase
      .from("coordinator_log_options")
      .insert({ list_key: listKey, label, sort_order: nextSortOrder, updated_by_user_id: updatedByUserId })
      .select()
      .single();
    if (!error && data) {
      invalidateCache(cacheKey);
      setOptions((prev) => [...prev, data as CoordinatorLogOption].sort((a, b) => a.sort_order - b.sort_order));
    }
    return { data: data as CoordinatorLogOption | null, error: error?.message ?? null };
  }

  async function updateOption(id: number, input: Partial<Pick<CoordinatorLogOption, "label" | "sort_order" | "is_active">>, updatedByUserId: string) {
    const { data, error } = await supabase
      .from("coordinator_log_options")
      .update({ ...input, updated_at: new Date().toISOString(), updated_by_user_id: updatedByUserId })
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      invalidateCache(cacheKey);
      setOptions((prev) => prev.map((o) => (o.id === id ? (data as CoordinatorLogOption) : o)).sort((a, b) => a.sort_order - b.sort_order));
    }
    return { data: data as CoordinatorLogOption | null, error: error?.message ?? null };
  }

  return { options, activeOptions, loading, error, refetch, createOption, updateOption };
}
