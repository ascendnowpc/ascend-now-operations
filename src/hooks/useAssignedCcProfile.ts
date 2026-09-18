import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { getCached, setCached } from "../lib/cache";
import type { PcProfile } from "../types/database";

interface AssignedCc {
  /** Null when the counsellor exists but hasn't had a profile card published. */
  profile: PcProfile | null;
  /** The counsellor's real name from `teachers`, for the card header. */
  counsellorName: string;
}

/**
 * The visual profile of the counsellor actively assigned to a given student,
 * for the student's My CC tab. The CC twin of `useAssignedPcProfile`, with two
 * deliberate differences:
 *
 *  - it chains through `cc_student_assignments` (RLS: a student reads their own
 *    assignment rows, and `Students read their assigned counsellor pc_profile`
 *    lets them read the matching card — see 20260808000000);
 *  - it returns the assignment even when there's no published card, because the
 *    student's My CC *tab* is driven by "do I have a counsellor at all", not by
 *    whether an admin has written their card yet.
 *
 * There is one profile table (`pc_profiles`) for both roles — a counsellor's
 * card is a row in it keyed by their teacher id.
 */
export function useAssignedCcProfile(studentId: string | null | undefined) {
  const [data, setData] = useState<AssignedCc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!studentId) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);

      const { data: assignment } = await supabase
        .from("cc_student_assignments")
        .select("cc_teacher_id")
        .eq("student_id", studentId)
        .is("unassigned_at", null)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const ccTeacherId = (assignment as { cc_teacher_id: string } | null)?.cc_teacher_id ?? null;
      if (!ccTeacherId) {
        if (!cancelled) { setData(null); setLoading(false); }
        return;
      }

      const [{ data: profileRow }, { data: teacherRow }] = await Promise.all([
        supabase.from("pc_profiles").select("*").eq("teacher_id", ccTeacherId).maybeSingle(),
        supabase.from("teachers").select("first_name, last_name").eq("id", ccTeacherId).maybeSingle(),
      ]);

      if (cancelled) return;

      const raw = (profileRow as PcProfile | null) ?? null;
      // Only surface a card an admin has actually filled in and published.
      const profile = raw && raw.is_published ? raw : null;
      const t = teacherRow as { first_name: string; last_name: string | null } | null;
      const counsellorName = t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : "";

      setData({ profile, counsellorName });
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [studentId]);

  return { assignedCc: data, loading };
}

// The last answer seen this session, per student. Separate from the 60s
// `cache` below and deliberately never expiring: the cache decides whether to
// re-ASK, this decides what to RENDER while asking. Without it the Counsellor
// tab blinks out of the sidebar on every navigation — see the hook below.
const lastKnownHasCc = new Map<string, boolean>();

/**
 * Just "does this student have a live counsellor" — what the student and
 * parent sidebars need to decide whether to show the Counsellor tab at all.
 * One small query rather than the full profile chain above.
 *
 * Both layouts re-mount on every navigation (each page renders its own
 * layout), so a fresh `useState(false)` here meant the tab disappeared and
 * came back on every single click — the answer was already known, it just
 * wasn't kept anywhere. Two things fix that, and they do different jobs:
 * `lastKnownHasCc` seeds the first render so the tab never blinks, and the
 * shared 60s cache decides whether to re-query at all. When the cache has
 * expired the previous answer stays on screen while the new one is in
 * flight, rather than being replaced by a guess of "no".
 */
export function useHasAssignedCc(studentId: string | null | undefined) {
  const cached = studentId ? getCached<boolean>(`hasCc:${studentId}`) : undefined;
  const [hasCc, setHasCc] = useState(
    studentId ? lastKnownHasCc.get(studentId) ?? false : false,
  );
  const [loading, setLoading] = useState(cached === undefined);

  useEffect(() => {
    let cancelled = false;
    if (!studentId) {
      setHasCc(false);
      setLoading(false);
      return;
    }

    // Switching child: show what we last knew about THIS one immediately,
    // rather than carrying the sibling's answer over.
    const seed = lastKnownHasCc.get(studentId);
    if (seed !== undefined) setHasCc(seed);

    const key = `hasCc:${studentId}`;
    const fresh = getCached<boolean>(key);
    if (fresh !== undefined) {
      setHasCc(fresh);
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase
      .from("cc_student_assignments")
      .select("id")
      .eq("student_id", studentId)
      .is("unassigned_at", null)
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return;
        const next = (data ?? []).length > 0;
        setCached(key, next);
        lastKnownHasCc.set(studentId, next);
        setHasCc(next);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [studentId]);

  return { hasCc, loading };
}
