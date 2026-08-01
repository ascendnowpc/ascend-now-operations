import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { invokeEdgeFunction, describeFunctionError } from "../lib/edgeFunctions";
import type { Teacher, TeacherSubject } from "../types/database";
import { getCached, setCached, invalidateCache } from "../lib/cache";

const TEACHERS_KEY = "teachers";
const SUBJECTS_KEY = "allTeacherSubjects";

// ---------------------------------------------------------------------------
// useTeachers — plain select, no nested join (FK may not exist in live DB yet)
// Subjects are fetched separately via useAllTeacherSubjects and merged.
// ---------------------------------------------------------------------------

export function useTeachers() {
  const [teachers, setTeachers] = useState<Teacher[]>(() => getCached<Teacher[]>(TEACHERS_KEY) ?? []);
  const [loading, setLoading] = useState(!getCached(TEACHERS_KEY));
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (force = false) => {
    const cached = getCached<Teacher[]>(TEACHERS_KEY);
    if (cached && !force) { setTeachers(cached); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("teachers")
      .select("*")
      .order("first_name", { ascending: true });
    if (error) {
      setError(error.message);
    } else {
      setCached(TEACHERS_KEY, data as Teacher[]);
      setTeachers(data as Teacher[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  async function createTeacher(input: Omit<Teacher, "id" | "created_at" | "updated_at">) {
    const { data, error } = await supabase.from("teachers").insert(input).select("*").single();
    if (!error && data) { invalidateCache(TEACHERS_KEY); setTeachers((prev) => [...prev, data as Teacher]); }
    return { data: data as Teacher | null, error: error?.message ?? null };
  }

  async function updateTeacher(id: string, input: Partial<Teacher>) {
    const { data, error } = await supabase.from("teachers").update(input).eq("id", id).select("*").single();
    if (!error && data) {
      invalidateCache(TEACHERS_KEY);
      setTeachers((prev) => prev.map((t) => (t.id === id ? (data as Teacher) : t)));
    }
    return { data: data as Teacher | null, error: error?.message ?? null };
  }

  return { teachers, loading, error, refetch, createTeacher, updateTeacher };
}

// ---------------------------------------------------------------------------
// useInactiveTeachers — deactivated teachers, for admin reactivation UI
// ---------------------------------------------------------------------------

export function useInactiveTeachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("teachers")
      .select("*")
      .eq("is_active", false)
      .order("first_name", { ascending: true });
    if (error) { setError(error.message); } else { setTeachers(data as Teacher[]); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  async function activateTeacher(id: string) {
    const { data: t, error: fetchErr } = await supabase.from("teachers").select("user_id").eq("id", id).single();
    if (fetchErr) return { error: fetchErr.message };
    const { error } = await supabase.from("teachers").update({ is_active: true }).eq("id", id);
    if (!error) {
      if (t?.user_id) {
        await supabase.from("users").update({ is_active: true }).eq("id", t.user_id);
      }
      invalidateCache(TEACHERS_KEY);
      setTeachers((prev) => prev.filter((teacher) => teacher.id !== id));
    }
    return { error: error?.message ?? null };
  }

  return { teachers, loading, error, refetch, activateTeacher };
}

// Drops the cached teachers list so the next `useTeachers()` mount refetches.
// Needed because creating a teacher/PC/CC goes through the
// `create-teacher-with-user` edge function, which never touches this cache —
// without this the /admin/teachers, /admin/pcs and /admin/ccs lists would keep
// serving a list without the person just added for up to the cache TTL.
export function invalidateTeachersCache() {
  invalidateCache(TEACHERS_KEY);
}

export async function fetchTeacherById(id: string) {
  const { data, error } = await supabase.from("teachers").select("*").eq("id", id).single();
  return { data: data as Teacher | null, error: error?.message ?? null };
}

// Routed through an edge function (not a plain client-side update) because
// deactivation has two requirements a bare `teachers.update` can't enforce:
// refusing to deactivate a coach who still has students actively assigned,
// and freeing the teacher's login email in Supabase Auth (whose uniqueness
// is enforced by Supabase itself, not by our own is_active flag) so it can
// be reused for a brand-new teacher later.
export async function deactivateTeacherById(teacher: Teacher) {
  const { data, error } = await invokeEdgeFunction("deactivate-teacher-with-user", {
    body: { teacher_id: teacher.id },
  });
  if (error) return { error: await describeFunctionError(error) };
  if (data?.error) return { error: data.error as string };
  invalidateCache(TEACHERS_KEY);
  return { error: null };
}

// ---------------------------------------------------------------------------
// useAllTeacherSubjects — fetches ALL subjects at once, keyed by teacher_id.
// Used in pages that need to show subjects alongside a full teacher list.
// ---------------------------------------------------------------------------

export function useAllTeacherSubjects() {
  const [subjectsByTeacher, setSubjectsByTeacher] = useState<Map<string, TeacherSubject[]>>(
    () => {
      const cached = getCached<TeacherSubject[]>(SUBJECTS_KEY);
      return cached ? groupByTeacher(cached) : new Map();
    }
  );
  const [loading, setLoading] = useState(!getCached(SUBJECTS_KEY));

  const refetch = useCallback(async (force = false) => {
    const cached = getCached<TeacherSubject[]>(SUBJECTS_KEY);
    if (cached && !force) { setSubjectsByTeacher(groupByTeacher(cached)); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("teacher_subjects")
      .select("*")
      .order("subject_id", { ascending: true });
    if (data) {
      setCached(SUBJECTS_KEY, data as TeacherSubject[]);
      setSubjectsByTeacher(groupByTeacher(data as TeacherSubject[]));
    }
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { subjectsByTeacher, loading, refetch };
}

function groupByTeacher(rows: TeacherSubject[]): Map<string, TeacherSubject[]> {
  const map = new Map<string, TeacherSubject[]>();
  for (const row of rows) {
    const existing = map.get(row.teacher_id) ?? [];
    map.set(row.teacher_id, [...existing, row]);
  }
  return map;
}

// Pure, unit-tested in utils/teacherSubjects; re-exported here for existing callers.
export { mergeWithSubjects } from "../utils/teacherSubjects";

// ---------------------------------------------------------------------------
// useTeacherSubjects — subjects for a single teacher (used in editors)
// ---------------------------------------------------------------------------

export function useTeacherSubjects(teacherId?: string) {
  const [subjects, setSubjects] = useState<TeacherSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!teacherId) { setSubjects([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("teacher_subjects")
      .select("*")
      .eq("teacher_id", teacherId)
      .order("subject_id", { ascending: true });
    if (error) { setError(error.message); } else { setSubjects(data as TeacherSubject[]); setError(null); }
    setLoading(false);
  }, [teacherId]);

  useEffect(() => { refetch(); }, [refetch]);

  async function addSubject(subjectId: number, curriculumId?: number | null) {
    if (!teacherId) return { error: "No teacher selected." };
    const { data, error } = await supabase
      .from("teacher_subjects")
      .insert({ teacher_id: teacherId, subject_id: subjectId, curriculum_id: curriculumId ?? null })
      .select()
      .single();
    if (!error) {
      invalidateCache(SUBJECTS_KEY);
      await refetch();  // always refetch to ensure fresh data
    }
    return { data: data as TeacherSubject | null, error: error?.message ?? null };
  }

  async function removeSubject(id: number) {
    const { error } = await supabase.from("teacher_subjects").delete().eq("id", id);
    if (!error) {
      invalidateCache(SUBJECTS_KEY);
      setSubjects((prev) => prev.filter((s) => s.id !== id));
    }
    return { error: error?.message ?? null };
  }

  return { subjects, loading, error, refetch, addSubject, removeSubject };
}
