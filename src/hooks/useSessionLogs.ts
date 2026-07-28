import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type { SessionLog } from "../types/database";
import { getCached, setCached, invalidateCachePrefix } from "../lib/cache";

export interface SessionLogFilters {
  year?: string;
  month?: string;
  teacherId?: number;
  coordinatorId?: number;
  studentFirstName?: string;
  studentLastName?: string;
  subjectId?: number;
  curriculumId?: number;
  programTypeIds?: string;
  noShowType?: 'no_show_1' | 'no_show_2' | 'no_show_plus' | 'any';
  studentId?: string;
  studentIdExact?: string;
  engagementRating?: 'low' | 'medium' | 'high';
  flagged?: 'yes' | 'no';
  dateFrom?: string;
  dateTo?: string;
}

function filtersKey(filters: SessionLogFilters, scopeToTeacherId?: number, scopeToStudentId?: string, scopeToStudentIdsKey?: string) {
  return `sessionLogs:${scopeToTeacherId ?? ""}:${scopeToStudentId ?? ""}:${scopeToStudentIdsKey ?? ""}:${JSON.stringify(filters)}`;
}

// scopeToStudentIds restricts to a whole set of students at once (e.g. a
// Performance Coach's assigned students, across every teacher who's logged
// a session for them) — distinct from scopeToStudentId, which scopes to
// exactly one student (a student's own portal view). Joined to a stable
// string for the effect/cache-key dependency since a fresh array reference
// would otherwise be seen as "changed" on every render.
export function useSessionLogs(filters: SessionLogFilters = {}, scopeToTeacherId?: number, scopeToStudentId?: string, scopeToStudentIds?: string[]) {
  const [logs, setLogs] = useState<SessionLog[]>([]);
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

    const key = filtersKey(filters, scopeToTeacherId, scopeToStudentId, scopeToStudentIdsKey);
    const cached = getCached<SessionLog[]>(key);
    if (cached) {
      setLogs(cached);
      setLoading(false);
      return;
    }

    setLoading(true);

    let query = supabase.from("session_logs").select("*").order("session_date", { ascending: false });

    if (scopeToTeacherId) {
      query = query.eq("teacher_id", scopeToTeacherId);
    }
    if (scopeToStudentId) {
      query = query.eq("student_id", scopeToStudentId);
    }
    if (scopeToStudentIds && scopeToStudentIds.length > 0) {
      query = query.in("student_id", scopeToStudentIds);
    }
    if (filters.studentIdExact) {
      query = query.eq("student_id", filters.studentIdExact);
    }
    if (filters.teacherId) {
      query = query.eq("teacher_id", filters.teacherId);
    }
    if (filters.coordinatorId) {
      query = query.eq("coordinator_teacher_id", filters.coordinatorId);
    }
    if (filters.year) {
      query = query
        .gte("session_date", `${filters.year}-01-01`)
        .lte("session_date", `${filters.year}-12-31`);
    }
    if (filters.year && filters.month) {
      const paddedMonth = filters.month.padStart(2, "0");
      const lastDay = new Date(Number(filters.year), Number(filters.month), 0).getDate();
      query = query
        .gte("session_date", `${filters.year}-${paddedMonth}-01`)
        .lte("session_date", `${filters.year}-${paddedMonth}-${lastDay}`);
    }
    if (filters.studentFirstName) {
      query = query.ilike("student_first_name", `%${filters.studentFirstName}%`);
    }
    if (filters.studentLastName) {
      query = query.ilike("student_last_name", `%${filters.studentLastName}%`);
    }
    if (filters.noShowType === 'any') {
      query = query.not('no_show_type', 'is', null);
    } else if (filters.noShowType) {
      query = query.eq('no_show_type', filters.noShowType);
    }
    if (filters.studentId) {
      query = query.ilike('student_id', `%${filters.studentId}%`);
    }
    if (filters.curriculumId) {
      query = query.eq('curriculum_id', filters.curriculumId);
    }
    if (filters.subjectId) {
      query = query.eq('subject_id', filters.subjectId);
    }
    if (filters.programTypeIds) {
      const ids = filters.programTypeIds.split(',').map(Number).filter(Boolean);
      if (ids.length === 1) {
        query = query.eq('program_type_id', ids[0]);
      } else if (ids.length > 1) {
        query = query.in('program_type_id', ids);
      }
    }
    if (filters.engagementRating) {
      query = query.eq('engagement_rating', filters.engagementRating);
    }
    if (filters.flagged === 'yes') {
      query = query.eq('flag_for_coach', true);
    } else if (filters.flagged === 'no') {
      query = query.eq('flag_for_coach', false);
    }
    if (filters.dateFrom) {
      query = query.gte('session_date', filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte('session_date', filters.dateTo);
    }

    const { data, error } = await query;

    if (error) {
      setError(error.message);
    } else {
      const rows = data as SessionLog[];
      setCached(key, rows);
      setLogs(rows);
      setError(null);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scopeToTeacherId,
    scopeToStudentId,
    scopeToStudentIdsKey,
    filters.studentIdExact,
    filters.teacherId,
    filters.coordinatorId,
    filters.year,
    filters.month,
    filters.studentFirstName,
    filters.studentLastName,
    filters.subjectId,
    filters.curriculumId,
    filters.programTypeIds,
    filters.noShowType,
    filters.studentId,
    filters.engagementRating,
    filters.flagged,
    filters.dateFrom,
    filters.dateTo,
  ]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function deleteSessionLog(id: number) {
    const { error } = await supabase.from("session_logs").delete().eq("id", id);
    if (!error) {
      invalidateCachePrefix("sessionLogs:");
      setLogs((prev) => prev.filter((l) => l.id !== id));
    }
    return { error: error?.message ?? null };
  }

  async function createSessionLog(input: Omit<SessionLog, "id" | "created_at" | "updated_at">) {
    const { data, error } = await supabase
      .from("session_logs")
      .insert(input)
      .select()
      .single();
    if (!error && data) {
      invalidateCachePrefix("sessionLogs:");
      setLogs((prev) => [data as SessionLog, ...prev]);
    }
    return { data: data as SessionLog | null, error: error?.message ?? null };
  }

  async function updateSessionLog(id: number, input: Partial<SessionLog>) {
    const { data, error } = await supabase
      .from("session_logs")
      .update(input)
      .eq("id", id)
      .select()
      .single();
    if (!error && data) {
      invalidateCachePrefix("sessionLogs:");
      setLogs((prev) => prev.map((l) => (l.id === id ? (data as SessionLog) : l)));
    }
    return { data: data as SessionLog | null, error: error?.message ?? null };
  }

  return { logs, loading, error, refetch, deleteSessionLog, createSessionLog, updateSessionLog };
}

export async function fetchSessionLogById(id: number) {
  const { data, error } = await supabase.from("session_logs").select("*").eq("id", id).single();
  return { data: data as SessionLog | null, error: error?.message ?? null };
}
