import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Student } from "../types/database";
import { getCached, setCached, invalidateCachePrefix } from "../lib/cache";

function byIdNum(a: Student, b: Student) {
  return (parseInt(a.id.slice(1)) || 0) - (parseInt(b.id.slice(1)) || 0);
}

// PostgREST caps any single request at this project's max-rows setting
// (1000) regardless of table size — a plain `.select("*")` silently
// truncates once the table crosses that count, which is exactly what
// happened once the 1001st student was added. Paginate through in pages
// until a short page signals the end.
const PAGE_SIZE = 1000;

export function useStudents() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const key = "students:all";
    const cached = getCached<Student[]>(key);
    if (cached) {
      setStudents(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    const all: Student[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("students")
        .select("*")
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const page = (data ?? []) as Student[];
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    const rows = all.sort(byIdNum);
    setCached(key, rows);
    setStudents(rows);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // Students are never created directly (no bare INSERT path in the UI) —
  // every student needs a login, which only the enrollment workflow's
  // review-enrollment-payment edge function sets up (mirroring how
  // create-teacher-with-user is the only way a teacher gets both a row and
  // an account). This hook only supports editing.
  async function updateStudent(id: string, input: Partial<Omit<Student, "id" | "created_at">>) {
    const { data, error } = await supabase
      .from("students")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      invalidateCachePrefix("students:");
      setStudents((prev) => prev.map((s) => (s.id === id ? (data as Student) : s)));
    }
    return { data: data as Student | null, error: error?.message ?? null };
  }

  function searchStudents(query: string): Student[] {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return students.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.first_name.toLowerCase().includes(q) ||
        s.last_name.toLowerCase().includes(q)
    );
  }

  return { students, loading, error, refetch, updateStudent, searchStudents };
}
