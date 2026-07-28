import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { SubjectCategory } from "../types/database";

export function useAllSubjectCategories() {
  const [categories, setCategories] = useState<SubjectCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("subject_categories")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setCategories(data as SubjectCategory[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function createCategory(input: { name: string; type: "academic" | "beyond_academic" }) {
    const { data, error } = await supabase
      .from("subject_categories")
      .insert(input)
      .select()
      .single();
    if (!error && data) {
      setCategories((prev) =>
        [...prev, data as SubjectCategory].sort((a, b) => a.sort_order - b.sort_order)
      );
    }
    return { data: data as SubjectCategory | null, error: error?.message ?? null };
  }

  async function updateCategory(id: number, input: Partial<SubjectCategory>) {
    const { data, error } = await supabase
      .from("subject_categories")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      setCategories((prev) => prev.map((c) => (c.id === id ? (data as SubjectCategory) : c)));
    }
    return { data: data as SubjectCategory | null, error: error?.message ?? null };
  }

  async function deleteCategory(id: number) {
    const { error } = await supabase
      .from("subject_categories")
      .update({ is_active: false })
      .eq("id", id);
    if (!error) {
      setCategories((prev) => prev.filter((c) => c.id !== id));
    }
    return { error: error?.message ?? null };
  }

  return { categories, loading, error, refetch, createCategory, updateCategory, deleteCategory };
}
