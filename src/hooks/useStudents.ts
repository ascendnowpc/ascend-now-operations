import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Student, StudentStatus } from "../types/database";
import { getCached, setCached, invalidateCachePrefix } from "../lib/cache";
import { idSeqNumber } from "../utils/entityId";

function byIdNum(a: Student, b: Student) {
  return idSeqNumber(a.id) - idSeqNumber(b.id);
}

/**
 * Moves a student between the Active / On pause / Completed categories.
 *
 * Goes through the `set_student_status` RPC rather than a plain UPDATE: a
 * performance coach has no UPDATE policy on `students` (RLS is row-level, so
 * "may edit only the status column" isn't expressible as a policy), and
 * completing a student must also close their PC assignment — a table a coach
 * cannot write at all. The function does the permission check and both writes
 * atomically; see 20260805000000_student_status_categories.sql.
 *
 * Standalone (not part of the hook) so views that load a single student
 * directly — e.g. StudentDetailView — can call it without pulling the whole
 * students list.
 */
export async function setStudentStatus(studentId: string, status: StudentStatus) {
  const { data, error } = await supabase.rpc("set_student_status", {
    p_student_id: studentId,
    p_status: status,
  });
  if (!error) invalidateCachePrefix("students:");
  return { data: (data as Student | null) ?? null, error: error?.message ?? null };
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

  // Same call as the standalone setStudentStatus above, but keeps this hook's
  // in-memory list in step so a list view re-renders with the new category.
  async function updateStudentStatus(id: string, status: StudentStatus) {
    const { data, error } = await setStudentStatus(id, status);
    if (!error && data) {
      setStudents((prev) => prev.map((s) => (s.id === id ? data : s)));
    }
    return { data, error };
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

  return { students, loading, error, refetch, updateStudent, updateStudentStatus, searchStudents };
}
