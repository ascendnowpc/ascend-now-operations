import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Curriculum } from "../types/database";

export function useCurricula() {
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("curricula")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setCurricula(data as Curriculum[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function createCurriculum(name: string, addedByTeacherId?: number) {
    const { data, error } = await supabase
      .from("curricula")
      .insert({ name, added_by_teacher_id: addedByTeacherId ?? null })
      .select()
      .single();
    if (!error && data) {
      setCurricula((prev) =>
        [...prev, data as Curriculum].sort((a, b) => a.sort_order - b.sort_order)
      );
    }
    return { data: data as Curriculum | null, error: error?.message ?? null };
  }

  return { curricula, loading, error, refetch, createCurriculum };
}

export function useAllCurricula() {
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("curricula")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setCurricula(data as Curriculum[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function createCurriculum(name: string, addedByTeacherId?: number) {
    const { data, error } = await supabase
      .from("curricula")
      .insert({ name, added_by_teacher_id: addedByTeacherId ?? null })
      .select()
      .single();
    if (!error && data) {
      setCurricula((prev) =>
        [...prev, data as Curriculum].sort((a, b) => a.sort_order - b.sort_order)
      );
    }
    return { data: data as Curriculum | null, error: error?.message ?? null };
  }

  async function updateCurriculum(id: number, input: Partial<Curriculum>) {
    const { data, error } = await supabase
      .from("curricula")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      setCurricula((prev) => prev.map((c) => (c.id === id ? (data as Curriculum) : c)));
    }
    return { data: data as Curriculum | null, error: error?.message ?? null };
  }

  async function deactivateCurriculum(id: number) {
    const { error } = await supabase
      .from("curricula")
      .update({ is_active: false })
      .eq("id", id);
    if (!error) {
      setCurricula((prev) => prev.map((c) => (c.id === id ? { ...c, is_active: false } : c)));
    }
    return { error: error?.message ?? null };
  }

  async function deleteCurriculum(id: number) {
    const { error } = await supabase
      .from("curricula")
      .delete()
      .eq("id", id);
    if (!error) {
      setCurricula((prev) => prev.filter((c) => c.id !== id));
    }
    return { error: error?.message ?? null };
  }

  return {
    curricula,
    loading,
    error,
    refetch,
    createCurriculum,
    updateCurriculum,
    deactivateCurriculum,
    deleteCurriculum,
  };
}
