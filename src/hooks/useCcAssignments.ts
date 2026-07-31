import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { CcAssignmentStatus, CcStudentAssignment } from "../types/database";

// Same PostgREST max-rows cap as usePcAssignments.ts — this table grows a row
// per assignment change rather than per student, so paginate rather than
// assuming one request returns everything.
const PAGE_SIZE = 1000;

/**
 * College Counsellor assignments — the CC counterpart to usePcAssignments.
 *
 * The shapes differ in one way that matters: a PC assignment has no status of
 * its own (its lifecycle is the student's), while a CC assignment carries
 * active/completed, because counselling ends while the student carries on.
 * Completing closes the row (`unassigned_at`) rather than deleting it, so
 * session logs written during the engagement stay attributable — a completed
 * student simply moves from the counsellor's active list to their completed
 * one.
 */
export function useCcAssignments() {
  const [assignments, setAssignments] = useState<CcStudentAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const all: CcStudentAssignment[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("cc_student_assignments")
        .select("*")
        .order("assigned_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const page = (data ?? []) as CcStudentAssignment[];
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    setAssignments(all);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const activeAssignments = assignments.filter((a) => a.unassigned_at === null);
  const completedAssignments = assignments.filter((a) => a.unassigned_at !== null);

  const assignedStudentIds = new Set(activeAssignments.map((a) => a.student_id));

  function getCcForStudent(studentId: string): string | null {
    return activeAssignments.find((a) => a.student_id === studentId)?.cc_teacher_id ?? null;
  }

  // The counsellor on the student's most recent assignment, open or closed —
  // how a completed student still shows up under the CC who saw them through.
  // `assignments` is ordered assigned_at desc, so the first hit is the latest.
  function getLatestCcForStudent(studentId: string): string | null {
    return assignments.find((a) => a.student_id === studentId)?.cc_teacher_id ?? null;
  }

  async function assignStudent(studentId: string, ccTeacherId: string) {
    // Close any live engagement first — uq_active_cc_per_student allows only
    // one open row per student, so a re-assignment has to end the old one.
    const existing = activeAssignments.find((a) => a.student_id === studentId);
    if (existing) {
      await supabase.rpc("set_cc_assignment_status", {
        p_assignment_id: existing.id,
        p_status: "completed",
      });
    }
    const { data, error } = await supabase
      .from("cc_student_assignments")
      .insert({ student_id: studentId, cc_teacher_id: ccTeacherId })
      .select()
      .single();
    if (!error) await refetch();
    return { data: data as CcStudentAssignment | null, error: error?.message ?? null };
  }

  // Completing and re-opening both go through the RPC: the status and
  // `unassigned_at` must move together, which a plain update can't guarantee.
  async function setAssignmentStatus(assignmentId: number, status: CcAssignmentStatus) {
    const { error } = await supabase.rpc("set_cc_assignment_status", {
      p_assignment_id: assignmentId,
      p_status: status,
    });
    if (!error) await refetch();
    return { error: error?.message ?? null };
  }

  // Removing an assignment made in error — no history worth keeping, unlike a
  // completed engagement. Admin-only via RLS.
  async function removeAssignment(assignmentId: number) {
    const { error } = await supabase
      .from("cc_student_assignments")
      .delete()
      .eq("id", assignmentId);
    if (!error) await refetch();
    return { error: error?.message ?? null };
  }

  return {
    assignments,
    activeAssignments,
    completedAssignments,
    assignedStudentIds,
    loading,
    error,
    refetch,
    getCcForStudent,
    getLatestCcForStudent,
    assignStudent,
    setAssignmentStatus,
    removeAssignment,
  };
}
