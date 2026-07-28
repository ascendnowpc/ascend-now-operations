import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { PcProfile } from "../types/database";

interface AssignedPc {
  profile: PcProfile; // always a published profile (null cases resolve to no section)
  coachName: string; // the coach's real name from `teachers`, for the card header
}

// Resolves the visual profile of the coach actively assigned to a given
// student, for the student's Overview tab. Chains: active
// pc_student_assignments row → pc_profiles row → teachers name. RLS lets a
// student read all three for their own assigned coach. Returns null when the
// student has no active coach or the coach hasn't published a profile yet.
export function useAssignedPcProfile(studentId: string | null | undefined) {
  const [data, setData] = useState<AssignedPc | null>(null);
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
        .from("pc_student_assignments")
        .select("pc_teacher_id")
        .eq("student_id", studentId)
        .is("unassigned_at", null)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const pcTeacherId = (assignment as { pc_teacher_id: number } | null)?.pc_teacher_id ?? null;
      if (!pcTeacherId) {
        if (!cancelled) { setData(null); setLoading(false); }
        return;
      }

      const [{ data: profileRow }, { data: teacherRow }] = await Promise.all([
        supabase.from("pc_profiles").select("*").eq("teacher_id", pcTeacherId).maybeSingle(),
        supabase.from("teachers").select("first_name, last_name").eq("id", pcTeacherId).maybeSingle(),
      ]);

      if (cancelled) return;

      const profile = (profileRow as PcProfile | null) ?? null;
      // Only surface a profile the coach has actually filled in.
      if (!profile || !profile.is_published) {
        setData(null);
        setLoading(false);
        return;
      }

      const t = teacherRow as { first_name: string; last_name: string | null } | null;
      const coachName = t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : "";
      setData({ profile, coachName });
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [studentId]);

  return { assignedPc: data, loading };
}
