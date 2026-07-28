import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { PcStudentAssignment } from "../types/database";

// PostgREST caps any single request at this project's max-rows setting
// (1000) regardless of table size — this table accumulates a row per
// assignment change, not per student, so it crosses that cap even sooner
// than `students`. Paginate through in pages until a short page signals
// the end (same fix as useStudents.ts).
const PAGE_SIZE = 1000;

export function usePcAssignments() {
  const [assignments, setAssignments] = useState<PcStudentAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const all: PcStudentAssignment[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("pc_student_assignments")
        .select("*")
        .order("assigned_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const page = (data ?? []) as PcStudentAssignment[];
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    setAssignments(all);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // Returns the active (unassigned_at IS NULL) assignments only
  const activeAssignments = assignments.filter((a) => a.unassigned_at === null);

  // Student IDs assigned to the current PC (used in PC-side views)
  const assignedStudentIds = new Set(activeAssignments.map((a) => a.student_id));

  // Returns the active pc_teacher_id for a given student, or null if unassigned
  function getPcForStudent(studentId: string): number | null {
    const active = activeAssignments.find((a) => a.student_id === studentId);
    return active?.pc_teacher_id ?? null;
  }

  async function assignStudent(studentId: string, pcTeacherId: number) {
    // Close any existing active assignment first
    const existing = activeAssignments.find((a) => a.student_id === studentId);
    if (existing) {
      await supabase
        .from("pc_student_assignments")
        .update({ unassigned_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    const { data, error } = await supabase
      .from("pc_student_assignments")
      .insert({ student_id: studentId, pc_teacher_id: pcTeacherId })
      .select()
      .single();
    if (!error) await refetch();
    return { data: data as PcStudentAssignment | null, error: error?.message ?? null };
  }

  async function unassignStudent(studentId: string) {
    const existing = activeAssignments.find((a) => a.student_id === studentId);
    if (!existing) return { error: "No active assignment found" };
    const { error } = await supabase
      .from("pc_student_assignments")
      .update({ unassigned_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (!error) await refetch();
    return { error: error?.message ?? null };
  }

  return {
    assignments,
    activeAssignments,
    assignedStudentIds,
    loading,
    error,
    refetch,
    getPcForStudent,
    assignStudent,
    unassignStudent,
  };
}
