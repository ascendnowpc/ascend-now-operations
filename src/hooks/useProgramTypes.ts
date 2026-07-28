import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { ProgramType } from "../types/database";
import { getCached, setCached, invalidateCache } from "../lib/cache";

const CACHE_KEY = "programTypes";

export function useProgramTypes() {
  const [programTypes, setProgramTypes] = useState<ProgramType[]>(() => getCached<ProgramType[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(!getCached(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (force = false) => {
    const cached = getCached<ProgramType[]>(CACHE_KEY);
    if (cached && !force) {
      setProgramTypes(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("program_types")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      setError(error.message);
    } else {
      const rows = data as ProgramType[];
      setCached(CACHE_KEY, rows);
      setProgramTypes(rows);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function createProgramType(name: string, parentId?: number | null, type?: string | null) {
    const { data, error } = await supabase
      .from("program_types")
      .insert({ name, parent_id: parentId ?? null, type: type ?? null })
      .select()
      .single();
    if (!error && data) {
      invalidateCache(CACHE_KEY);
      setProgramTypes((prev) => [...prev, data as ProgramType].sort((a, b) => a.name.localeCompare(b.name)));
    }
    return { data: data as ProgramType | null, error: error?.message ?? null };
  }

  async function updateProgramType(id: number, input: Partial<ProgramType>) {
    const { data, error } = await supabase
      .from("program_types")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      invalidateCache(CACHE_KEY);
      setProgramTypes((prev) => prev.map((p) => (p.id === id ? (data as ProgramType) : p)));
    }
    return { data: data as ProgramType | null, error: error?.message ?? null };
  }

  async function deleteProgramType(id: number) {
    const { error } = await supabase.from("program_types").delete().eq("id", id);
    if (!error) {
      invalidateCache(CACHE_KEY);
      setProgramTypes((prev) => prev.filter((p) => p.id !== id));
    }
    return { error: error?.message ?? null };
  }

  return {
    programTypes,
    loading,
    error,
    refetch,
    createProgramType,
    updateProgramType,
    deleteProgramType,
  };
}
