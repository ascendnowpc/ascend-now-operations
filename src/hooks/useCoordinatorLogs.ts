import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { CoordinatorLog, CoordinatorLogSubject, CoordinatorLogPackageStatus } from "../types/database";
import { getCached, setCached, invalidateCachePrefix } from "../lib/cache";

export interface CoordinatorLogFilters {
  studentId?: string;
  teacherId?: number;
  courseTypeId?: number;
  primaryGoalOptionId?: number;
  progressStatusOptionId?: number;
  biggestChallengeOptionId?: number;
  nextActionOptionId?: number;
  renewalStatusOptionId?: number;
  referralStatusOptionId?: number;
  primaryRelationshipOwner?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CoordinatorLogSubjectInput {
  subject_id: number;
  curriculum_id: number | null;
  baseline_score: string | null;
  baseline_score_date: string | null;
  final_outcome_grade: string | null;
}

// is_automated is set by the DB (default false for manual inserts, true by the
// renewal automation), so it's never part of what the form submits.
export type CoordinatorLogInput = Omit<CoordinatorLog, "id" | "created_at" | "updated_at" | "is_automated">;

function filtersKey(filters: CoordinatorLogFilters, scopeToStudentIdsKey?: string) {
  return `coordinatorLogs:${scopeToStudentIdsKey ?? ""}:${JSON.stringify(filters)}`;
}

// scopeToStudentIds restricts the list to one set of students at once (a PC's
// assigned students) — mirrors useSessionLogs.ts's identical param; undefined
// means no restriction (admin sees every log, scoped only by RLS).
export function useCoordinatorLogs(filters: CoordinatorLogFilters = {}, scopeToStudentIds?: string[]) {
  const [logs, setLogs] = useState<CoordinatorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scopeToStudentIdsKey = scopeToStudentIds?.join(",") ?? "";

  const refetch = useCallback(async () => {
    if (scopeToStudentIds && scopeToStudentIds.length === 0) {
      setLogs([]);
      setLoading(false);
      setError(null);
      return;
    }

    const key = filtersKey(filters, scopeToStudentIdsKey);
    const cached = getCached<CoordinatorLog[]>(key);
    if (cached) {
      setLogs(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    let query = supabase.from("coordinator_logs").select("*").order("log_date", { ascending: false }).order("id", { ascending: false });

    if (scopeToStudentIds && scopeToStudentIds.length > 0) {
      query = query.in("student_id", scopeToStudentIds);
    }
    if (filters.studentId) query = query.eq("student_id", filters.studentId);
    if (filters.teacherId) query = query.eq("teacher_id", filters.teacherId);
    if (filters.courseTypeId) query = query.contains("course_type_ids", [filters.courseTypeId]);
    if (filters.primaryGoalOptionId) query = query.eq("primary_goal_option_id", filters.primaryGoalOptionId);
    if (filters.progressStatusOptionId) query = query.eq("progress_status_option_id", filters.progressStatusOptionId);
    if (filters.biggestChallengeOptionId) query = query.eq("biggest_challenge_option_id", filters.biggestChallengeOptionId);
    if (filters.nextActionOptionId) query = query.eq("next_action_option_id", filters.nextActionOptionId);
    if (filters.renewalStatusOptionId) query = query.eq("renewal_status_option_id", filters.renewalStatusOptionId);
    if (filters.referralStatusOptionId) query = query.eq("referral_status_option_id", filters.referralStatusOptionId);
    if (filters.primaryRelationshipOwner) query = query.eq("primary_relationship_owner", filters.primaryRelationshipOwner);
    if (filters.dateFrom) query = query.gte("log_date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("log_date", filters.dateTo);

    const { data, error } = await query;
    if (error) {
      setError(error.message);
    } else {
      const rows = (data ?? []) as CoordinatorLog[];
      setCached(key, rows);
      setLogs(rows);
      setError(null);
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scopeToStudentIdsKey,
    filters.studentId,
    filters.teacherId,
    filters.courseTypeId,
    filters.primaryGoalOptionId,
    filters.progressStatusOptionId,
    filters.biggestChallengeOptionId,
    filters.nextActionOptionId,
    filters.renewalStatusOptionId,
    filters.referralStatusOptionId,
    filters.primaryRelationshipOwner,
    filters.dateFrom,
    filters.dateTo,
  ]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function deleteCoordinatorLog(id: number) {
    const { error } = await supabase.from("coordinator_logs").delete().eq("id", id);
    if (!error) {
      invalidateCachePrefix("coordinatorLogs:");
      setLogs((prev) => prev.filter((l) => l.id !== id));
    }
    return { error: error?.message ?? null };
  }

  return { logs, loading, error, refetch, deleteCoordinatorLog };
}

// Every coordinator log for one student, most recent first — backs the
// StudentDetailView "Coordinator Log" tab (latest snapshot stays on top,
// older entries remain as history below it).
export function useStudentCoordinatorLogs(studentId: string | undefined) {
  const [logs, setLogs] = useState<CoordinatorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!studentId) {
      setLogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("coordinator_logs")
      .select("*")
      .eq("student_id", studentId)
      // id desc breaks ties within a day: the automation can file several logs
      // on the same date (each package-status change appends one), so ordering
      // by log_date alone would leave "which is latest" undefined and could put
      // a stale same-day snapshot on top.
      .order("log_date", { ascending: false })
      .order("id", { ascending: false });
    if (error) {
      setError(error.message);
    } else {
      setLogs((data ?? []) as CoordinatorLog[]);
      setError(null);
    }
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { logs, loading, error, refetch };
}

export async function deleteCoordinatorLogById(id: number): Promise<{ error: string | null }> {
  const { error } = await supabase.from("coordinator_logs").delete().eq("id", id);
  if (!error) invalidateCachePrefix("coordinatorLogs:");
  return { error: error?.message ?? null };
}

export async function fetchCoordinatorLogById(
  id: number,
): Promise<{ data: (CoordinatorLog & { subjects: CoordinatorLogSubject[]; package_statuses: CoordinatorLogPackageStatus[] }) | null; error: string | null }> {
  const [{ data: log, error: logError }, { data: subjects, error: subjectsError }, { data: pkgStatuses, error: pkgError }] = await Promise.all([
    supabase.from("coordinator_logs").select("*").eq("id", id).single(),
    supabase
      .from("coordinator_log_subjects")
      .select("*")
      .eq("coordinator_log_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("coordinator_log_package_statuses")
      .select("*")
      .eq("coordinator_log_id", id)
      .order("sort_order", { ascending: true }),
  ]);
  if (logError) return { data: null, error: logError.message };
  if (subjectsError) return { data: null, error: subjectsError.message };
  if (pkgError) return { data: null, error: pkgError.message };
  return {
    data: {
      ...(log as CoordinatorLog),
      subjects: (subjects ?? []) as CoordinatorLogSubject[],
      package_statuses: (pkgStatuses ?? []) as CoordinatorLogPackageStatus[],
    },
    error: null,
  };
}

// The student's most recent coordinator log (with its subjects), or null if
// they have none yet. Backs the form's "prefill from the previous log" flow:
// selecting a student pulls their latest snapshot so the PC edits forward from
// it, and saving always writes a new row (history is never overwritten).
export async function fetchLatestCoordinatorLogForStudent(
  studentId: string,
): Promise<{ data: (CoordinatorLog & { subjects: CoordinatorLogSubject[] }) | null; error: string | null }> {
  const { data: log, error: logError } = await supabase
    .from("coordinator_logs")
    .select("*")
    .eq("student_id", studentId)
    .order("log_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (logError) return { data: null, error: logError.message };
  if (!log) return { data: null, error: null };
  const { data: subjects, error: subjectsError } = await supabase
    .from("coordinator_log_subjects")
    .select("*")
    .eq("coordinator_log_id", (log as CoordinatorLog).id)
    .order("sort_order", { ascending: true });
  if (subjectsError) return { data: null, error: subjectsError.message };
  return { data: { ...(log as CoordinatorLog), subjects: (subjects ?? []) as CoordinatorLogSubject[] }, error: null };
}

export interface SubjectGradeHistoryEntry {
  log_id: number;
  log_date: string;
  baseline_score: string | null;
  baseline_score_date: string | null;
  current_grade: string | null; // stored as coordinator_log_subjects.final_outcome_grade
}

// Per-subject timeline of baseline + current grade across ALL of a student's
// coordinator logs (chronological), keyed by `${subject_id}:${curriculum_id ?? ""}`.
// Backs the "Current Grades" versioning: the form shows a subject's earlier
// grades while the PC records a new one, and the read view shows the whole series.
export async function fetchSubjectGradeHistoryForStudent(
  studentId: string,
): Promise<Record<string, SubjectGradeHistoryEntry[]>> {
  const { data: logs, error: logsErr } = await supabase
    .from("coordinator_logs")
    .select("id, log_date")
    .eq("student_id", studentId)
    .order("log_date", { ascending: true })
    .order("id", { ascending: true });
  if (logsErr || !logs || logs.length === 0) return {};
  const logRows = logs as { id: number; log_date: string }[];
  const logDateById = new Map(logRows.map((l) => [l.id, l.log_date]));
  const { data: subs, error: subsErr } = await supabase
    .from("coordinator_log_subjects")
    .select("coordinator_log_id, subject_id, curriculum_id, baseline_score, baseline_score_date, final_outcome_grade")
    .in("coordinator_log_id", logRows.map((l) => l.id));
  if (subsErr || !subs) return {};
  const map: Record<string, SubjectGradeHistoryEntry[]> = {};
  for (const s of subs as { coordinator_log_id: number; subject_id: number; curriculum_id: number | null; baseline_score: string | null; baseline_score_date: string | null; final_outcome_grade: string | null }[]) {
    const key = `${s.subject_id}:${s.curriculum_id ?? ""}`;
    (map[key] ??= []).push({
      log_id: s.coordinator_log_id,
      log_date: logDateById.get(s.coordinator_log_id) ?? "",
      baseline_score: s.baseline_score,
      baseline_score_date: s.baseline_score_date,
      current_grade: s.final_outcome_grade,
    });
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => a.log_date.localeCompare(b.log_date) || a.log_id - b.log_id);
  }
  return map;
}

export function useCoordinatorLogMutations() {
  async function createCoordinatorLog(input: CoordinatorLogInput, subjects: CoordinatorLogSubjectInput[]) {
    const { data, error } = await supabase.from("coordinator_logs").insert(input).select().single();
    if (error || !data) return { data: null, error: error?.message ?? "Failed to create coordinator log" };
    const log = data as CoordinatorLog;
    if (subjects.length > 0) {
      const { error: subjError } = await supabase
        .from("coordinator_log_subjects")
        .insert(subjects.map((s, i) => ({ ...s, coordinator_log_id: log.id, sort_order: i })));
      if (subjError) return { data: log, error: subjError.message };
    }
    invalidateCachePrefix("coordinatorLogs:");
    return { data: log, error: null };
  }

  // Snapshot-rewrites the subject list (delete then reinsert the current set)
  // rather than diffing — the same approach this codebase already uses for
  // small per-parent child lists rewritten wholesale from a form.
  async function updateCoordinatorLog(id: number, input: Partial<CoordinatorLogInput>, subjects: CoordinatorLogSubjectInput[]) {
    const { data, error } = await supabase.from("coordinator_logs").update(input).eq("id", id).select().single();
    if (error || !data) return { data: null, error: error?.message ?? "Failed to update coordinator log" };

    const { error: deleteError } = await supabase.from("coordinator_log_subjects").delete().eq("coordinator_log_id", id);
    if (deleteError) return { data: data as CoordinatorLog, error: deleteError.message };

    if (subjects.length > 0) {
      const { error: subjError } = await supabase
        .from("coordinator_log_subjects")
        .insert(subjects.map((s, i) => ({ ...s, coordinator_log_id: id, sort_order: i })));
      if (subjError) return { data: data as CoordinatorLog, error: subjError.message };
    }
    invalidateCachePrefix("coordinatorLogs:");
    return { data: data as CoordinatorLog, error: null };
  }

  return { createCoordinatorLog, updateCoordinatorLog };
}
