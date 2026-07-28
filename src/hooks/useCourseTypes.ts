import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { CourseType } from "../types/database";
import { getCached, setCached, invalidateCache } from "../lib/cache";

const CACHE_KEY = "courseTypes";

export function useCourseTypes() {
  const [courseTypes, setCourseTypes] = useState<CourseType[]>(() => getCached<CourseType[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(!getCached(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (force = false) => {
    const cached = getCached<CourseType[]>(CACHE_KEY);
    if (cached && !force) {
      setCourseTypes(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("course_types")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      setError(error.message);
    } else {
      const rows = data as CourseType[];
      setCached(CACHE_KEY, rows);
      setCourseTypes(rows);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function createCourseType(name: string, color?: string) {
    const { data, error } = await supabase
      .from("course_types")
      .insert({ name, color: color ?? "slate" })
      .select()
      .single();
    if (!error && data) {
      invalidateCache(CACHE_KEY);
      setCourseTypes((prev) => [...prev, data as CourseType].sort((a, b) => a.sort_order - b.sort_order));
    }
    return { data: data as CourseType | null, error: error?.message ?? null };
  }

  async function updateCourseType(id: number, input: Partial<CourseType>) {
    const { data, error } = await supabase
      .from("course_types")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      invalidateCache(CACHE_KEY);
      setCourseTypes((prev) => prev.map((p) => (p.id === id ? (data as CourseType) : p)));
    }
    return { data: data as CourseType | null, error: error?.message ?? null };
  }

  async function deleteCourseType(id: number) {
    const { error } = await supabase.from("course_types").delete().eq("id", id);
    if (!error) {
      invalidateCache(CACHE_KEY);
      setCourseTypes((prev) => prev.filter((p) => p.id !== id));
    }
    return { error: error?.message ?? null };
  }

  return {
    courseTypes,
    loading,
    error,
    refetch,
    createCourseType,
    updateCourseType,
    deleteCourseType,
  };
}
