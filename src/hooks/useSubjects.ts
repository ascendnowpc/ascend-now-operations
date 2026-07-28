import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Subject } from "../types/database";

// Shared helper: handle unique-constraint violations when creating a subject.
// After migration 21, the constraint is (name, category_id) — same name can
// exist in different sections. This resolves the conflict by reactivating an
// inactive row in the same section, or returning a clear error for active dupes.
async function resolveUniqueViolation(
  input: { name: string; category: string; category_id?: number },
  error: { code: string; message: string },
): Promise<{ data: Subject | null; error: string | null } | null> {
  const isConstraint =
    error.code === "23505" &&
    (error.message.includes("subjects_name_key") ||
      error.message.includes("subjects_name_category_key"));
  if (!isConstraint) return null;

  // Find existing row scoped to the same section
  let q = supabase.from("subjects").select("*").eq("name", input.name);
  if (input.category_id != null) {
    q = q.eq("category_id", input.category_id);
  } else {
    q = q.is("category_id", null);
  }
  const { data: existing } = await q.maybeSingle();

  if (existing && !(existing as Subject).is_active) {
    const patch: Partial<Subject> = {
      is_active: true,
      category: input.category,
      ...(input.category_id != null ? { category_id: input.category_id } : {}),
    };
    const { data: updated, error: updateErr } = await supabase
      .from("subjects")
      .update(patch)
      .eq("id", (existing as Subject).id)
      .select()
      .single();
    if (!updateErr && updated) return { data: updated as Subject, error: null };
    return { data: null, error: updateErr?.message ?? null };
  }

  return { data: null, error: `"${input.name}" already exists in this section.` };
}

export function useSubjects(category?: string) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("subjects")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (category) {
      query = query.eq("category", category);
    }
    const { data, error } = await query;
    if (error) {
      setError(error.message);
    } else {
      setSubjects(data as Subject[]);
      setError(null);
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function createSubject(input: { name: string; category: string; category_id?: number; curriculum_group_id?: number; curriculum_id?: number; board?: string; subject_code?: string; level?: string; added_by_teacher_id?: number }) {
    const { data, error } = await supabase
      .from("subjects")
      .insert(input)
      .select()
      .single();
    if (!error && data) {
      setSubjects((prev) =>
        [...prev, data as Subject].sort((a, b) => a.sort_order - b.sort_order)
      );
      return { data: data as Subject, error: null };
    }
    if (error) {
      const resolved = await resolveUniqueViolation(input, error);
      if (resolved) {
        if (!resolved.error && resolved.data) {
          setSubjects((prev) =>
            [...prev, resolved.data!].sort((a, b) => a.sort_order - b.sort_order)
          );
        }
        return resolved;
      }
    }
    return { data: null, error: error?.message ?? null };
  }

  return { subjects, loading, error, refetch, createSubject };
}

/** Fetches active subjects belonging to a specific curriculum group. */
export function useSubjectsByGroup(curriculumGroupId: number | null) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (curriculumGroupId === null) {
      setSubjects([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("subjects")
      .select("*")
      .eq("is_active", true)
      .eq("curriculum_group_id", curriculumGroupId)
      .order("sort_order", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setSubjects(data as Subject[]);
      setError(null);
    }
    setLoading(false);
  }, [curriculumGroupId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { subjects, loading, error, refetch };
}

export function useAllSubjects() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("subjects")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setSubjects(data as Subject[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function createSubject(input: { name: string; category: string; category_id?: number; curriculum_group_id?: number; curriculum_id?: number; board?: string; subject_code?: string; level?: string; added_by_teacher_id?: number }) {
    const { data, error } = await supabase
      .from("subjects")
      .insert(input)
      .select()
      .single();
    if (!error && data) {
      setSubjects((prev) =>
        [...prev, data as Subject].sort((a, b) => a.sort_order - b.sort_order)
      );
      return { data: data as Subject, error: null };
    }
    if (error) {
      const resolved = await resolveUniqueViolation(input, error);
      if (resolved) {
        if (!resolved.error && resolved.data) {
          setSubjects((prev) =>
            [...prev, resolved.data!].sort((a, b) => a.sort_order - b.sort_order)
          );
        }
        return resolved;
      }
    }
    return { data: null, error: error?.message ?? null };
  }

  async function updateSubject(id: number, input: Partial<Subject>) {
    const { data, error } = await supabase
      .from("subjects")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      setSubjects((prev) => prev.map((s) => (s.id === id ? (data as Subject) : s)));
    }
    return { data: data as Subject | null, error: error?.message ?? null };
  }

  async function deleteSubject(id: number) {
    const { error } = await supabase
      .from("subjects")
      .delete()
      .eq("id", id);
    if (!error) {
      setSubjects((prev) => prev.filter((s) => s.id !== id));
    }
    return { error: error?.message ?? null };
  }

  async function deactivateSubject(id: number) {
    const { error } = await supabase
      .from("subjects")
      .update({ is_active: false })
      .eq("id", id);
    if (!error) {
      setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, is_active: false } : s)));
    }
    return { error: error?.message ?? null };
  }

  return {
    subjects,
    loading,
    error,
    refetch,
    createSubject,
    updateSubject,
    deleteSubject,
    deactivateSubject,
  };
}
