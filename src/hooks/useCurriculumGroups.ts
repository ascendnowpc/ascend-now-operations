import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { CurriculumGroup } from "../types/database";

export function useCurriculumGroups(curriculumId?: number) {
  const [groups, setGroups] = useState<CurriculumGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (curriculumId === undefined) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("curriculum_groups")
      .select("*")
      .eq("curriculum_id", curriculumId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setGroups(data as CurriculumGroup[]);
      setError(null);
    }
    setLoading(false);
  }, [curriculumId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { groups, loading, error, refetch };
}

// Fetches ALL curriculum groups (active and inactive).
// Consumer pages that only want active groups must filter by is_active themselves.
export function useAllCurriculumGroups() {
  const [groups, setGroups] = useState<CurriculumGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("curriculum_groups")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setGroups(data as CurriculumGroup[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function createGroup(curriculumId: number, name: string) {
    const maxSort = groups
      .filter((g) => g.curriculum_id === curriculumId)
      .reduce((m, g) => Math.max(m, g.sort_order), 0);
    const { data, error } = await supabase
      .from("curriculum_groups")
      .insert({ curriculum_id: curriculumId, name, sort_order: maxSort + 1 })
      .select()
      .single();
    if (!error && data) {
      setGroups((prev) =>
        [...prev, data as CurriculumGroup].sort((a, b) => a.sort_order - b.sort_order)
      );
    }
    return { data: data as CurriculumGroup | null, error: error?.message ?? null };
  }

  async function updateGroup(id: number, input: Partial<CurriculumGroup>) {
    const { data, error } = await supabase
      .from("curriculum_groups")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      setGroups((prev) => prev.map((g) => (g.id === id ? (data as CurriculumGroup) : g)));
    }
    return { data: data as CurriculumGroup | null, error: error?.message ?? null };
  }

  async function deactivateGroup(id: number) {
    const { error } = await supabase
      .from("curriculum_groups")
      .update({ is_active: false })
      .eq("id", id);
    if (!error) {
      setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, is_active: false } : g)));
    }
    return { error: error?.message ?? null };
  }

  async function reactivateGroup(id: number) {
    const { error } = await supabase
      .from("curriculum_groups")
      .update({ is_active: true })
      .eq("id", id);
    if (!error) {
      setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, is_active: true } : g)));
    }
    return { error: error?.message ?? null };
  }

  return { groups, loading, error, refetch, createGroup, updateGroup, deactivateGroup, reactivateGroup };
}

// Pure, unit-tested in utils/subjectGrouping; re-exported here for existing callers.
export { subjectDisplayLabel, subjectBaseLabel, groupSubjectsByBase } from "../utils/subjectGrouping";
export type { SubjectBaseGroup } from "../utils/subjectGrouping";
