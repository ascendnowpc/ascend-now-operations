import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { PcStudentAssignment } from "../types/database";
import { notificationsForAssign, notificationsForRemoval } from "../utils/assignmentNotifications";
import { notifyAssignmentChange } from "../lib/assignmentNotifier";

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
  function getPcForStudent(studentId: string): string | null {
    const active = activeAssignments.find((a) => a.student_id === studentId);
    return active?.pc_teacher_id ?? null;
  }

  // The coach on the student's most recent assignment, active or not. Completing
  // a student unassigns them (set_student_status closes the row), so this is the
  // only way a completed student still shows up under the coach who saw them
  // through — `assignments` is ordered assigned_at desc, so the first hit is the
  // latest one, which matters for a student who changed coaches before finishing.
  function getLatestPcForStudent(studentId: string): string | null {
    return assignments.find((a) => a.student_id === studentId)?.pc_teacher_id ?? null;
  }

  async function assignStudent(studentId: string, pcTeacherId: string) {
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
    if (!error) {
      const created = data as PcStudentAssignment;
      // A reassignment tells both coaches — the one who lost the student and
      // the one who gained them (see assignmentNotifications.ts).
      notifyAssignmentChange(
        notificationsForAssign({
          role: "pc",
          newAssignmentId: created.id,
          newTeacherId: pcTeacherId,
          closed: existing ? { assignmentId: existing.id, teacherId: existing.pc_teacher_id } : null,
        })
      );
      await refetch();
    }
    return { data: data as PcStudentAssignment | null, error: error?.message ?? null };
  }

  async function unassignStudent(studentId: string) {
    const existing = activeAssignments.find((a) => a.student_id === studentId);
    if (!existing) return { error: "No active assignment found" };
    const { error } = await supabase
      .from("pc_student_assignments")
      .update({ unassigned_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (!error) {
      notifyAssignmentChange(notificationsForRemoval("pc", existing.id));
      await refetch();
    }
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
    getLatestPcForStudent,
    assignStudent,
    unassignStudent,
  };
}
