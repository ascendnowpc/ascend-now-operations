import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
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

/**
 * Just "does this student have a live counsellor" — what the student sidebar
 * needs to decide whether to show the My CC tab at all. One small query rather
 * than the full profile chain above, since the layout re-mounts on every nav.
 */
export function useHasAssignedCc(studentId: string | null | undefined) {
  const [hasCc, setHasCc] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!studentId) {
      setHasCc(false);
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
        setHasCc((data ?? []).length > 0);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [studentId]);

  return { hasCc, loading };
}
