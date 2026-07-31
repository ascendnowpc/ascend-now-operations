import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Student, StudentStatus } from "../types/database";
import { getCached, setCached, invalidateCachePrefix } from "../lib/cache";
import { idSeqNumber } from "../utils/entityId";
import { notificationsForStudentCompletion } from "../utils/assignmentNotifications";
import { notifyAssignmentChange } from "../lib/assignmentNotifier";

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
  // Completing closes the student's live PC and CC assignments inside the RPC,
  // and both of those people need telling. Read the ids first — once the RPC
  // has run there's no way to tell an engagement that just ended from one that
  // ended months ago.
  const closing = status === "completed" ? await liveAssignmentIds(studentId) : null;

  const { data, error } = await supabase.rpc("set_student_status", {
    p_student_id: studentId,
    p_status: status,
  });
  if (!error) {
    invalidateCachePrefix("students:");
    if (closing) notifyAssignmentChange(notificationsForStudentCompletion(closing));
  }
  return { data: (data as Student | null) ?? null, error: error?.message ?? null };
}

// The student's currently-open PC and CC assignment ids, if any. Best-effort:
// a failed lookup costs a notification, never the status change itself.
async function liveAssignmentIds(studentId: string) {
  const [pc, cc] = await Promise.all([
    supabase
      .from("pc_student_assignments")
      .select("id")
      .eq("student_id", studentId)
      .is("unassigned_at", null)
      .maybeSingle(),
    supabase
      .from("cc_student_assignments")
      .select("id")
      .eq("student_id", studentId)
      .is("unassigned_at", null)
      .maybeSingle(),
  ]);
  return {
    pcAssignmentId: (pc.data as { id: number } | null)?.id ?? null,
    ccAssignmentId: (cc.data as { id: number } | null)?.id ?? null,
  };
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
