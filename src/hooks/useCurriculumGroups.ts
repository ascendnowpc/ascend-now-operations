import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { CurriculumGroup, Subject } from "../types/database";

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

/** Build a human-readable display label for a subject including board/code/level. */
export function subjectDisplayLabel(
  name: string,
  board: string | null,
  subjectCode: string | null,
  level: string | null,
): string {
  const parts: string[] = [name];
  if (board && subjectCode) {
    parts.push(`${board} (${subjectCode})`);
  } else if (board) {
    parts.push(board);
  }
  if (level) parts.push(level);
  return parts.join(" — ");
}

/** Display label for a subject WITHOUT its level (e.g. "English" instead of "English — SL"). */
export function subjectBaseLabel(
  name: string,
  board: string | null,
  subjectCode: string | null,
): string {
  const parts: string[] = [name];
  if (board && subjectCode) {
    parts.push(`${board} (${subjectCode})`);
  } else if (board) {
    parts.push(board);
  }
  return parts.join(" — ");
}

export type SubjectBaseGroup = { key: string; baseLabel: string; items: Subject[] };

/**
 * Groups subjects that share the same name/board/code but differ only by level
 * (e.g. "English" SL/HL) so a UI can offer a single subject choice plus a
 * separate level dropdown, instead of listing the same subject name twice.
 */
export function groupSubjectsByBase(subjects: Subject[]): SubjectBaseGroup[] {
  const map = new Map<string, SubjectBaseGroup>();
  for (const s of subjects) {
    const key = `${s.name}|${s.board ?? ""}|${s.subject_code ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.items.push(s);
    } else {
      map.set(key, { key, baseLabel: subjectBaseLabel(s.name, s.board, s.subject_code), items: [s] });
    }
  }
  for (const g of map.values()) {
    g.items.sort((a, b) => (a.level ?? "").localeCompare(b.level ?? ""));
  }
  return Array.from(map.values());
}
