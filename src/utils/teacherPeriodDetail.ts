import { supabase } from "../lib/supabaseClient";
import { subjectLabel } from "./subjectLabel";
import type { NoShowType, Teacher } from "../types/database";
export { isPayableNoShow } from "./noShow";

export const NO_SHOW_LABELS: Record<string, string> = {
  no_show_1: "No Show 1",
  no_show_2: "No Show 2",
  no_show_plus: "No Show +",
};

export function subjLabel(name: string | null, level: string | null) {
  return name ? subjectLabel(name, level) : "—";
}

export interface TeacherHoursBreakdown {
  subjectName: string;
  subjectLevel: string | null;
  curriculumName: string | null;
  programTypeName: string | null;
  sessions: number;
  hours: number;
}

export interface TeacherNoShow {
  date: string;
  studentName: string;
  subjectName: string | null;
  subjectLevel: string | null;
  noShowLabel: string;
  noShowType: NoShowType;
}

export interface TeacherSessionRow {
  date: string;
  studentName: string;
  subjectName: string | null;
  subjectLevel: string | null;
  curriculumName: string | null;
  programTypeName: string | null;
  hours: number | null;
  topic: string | null;
  noShowLabel: string | null;
}

export interface TeacherPeriodDetail {
  teacher: Teacher | null;
  subjectsTaught: string[];
  breakdown: TeacherHoursBreakdown[];
  noShows: TeacherNoShow[];
  sessions: TeacherSessionRow[];
  totalHours: number;
  totalSessions: number;
  periodStart: string;
  periodEnd: string;
}

// Full drill-down report for one teacher over one month: their profile,
// subjects taught, hours broken down by subject/curriculum/program, every
// no-show, and the full raw session list. Shared by the admin Teacher Hours
// report and by the teacher/PC-facing "My Hours" page — both drill into the
// exact same breakdown for a single teacher_id.
export async function fetchTeacherPeriodDetail(teacherId: number, year: number, month: number): Promise<TeacherPeriodDetail> {
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  const [
    { data: teacher },
    { data: teacherSubjects },
    { data: sessions },
    { data: students },
  ] = await Promise.all([
    supabase.from("teachers").select("*").eq("id", teacherId).single(),
    supabase.from("teacher_subjects").select("subject_id, curriculum_id, subjects(name, level), curricula(name)").eq("teacher_id", teacherId),
    supabase
      .from("session_logs")
      .select("session_date, session_duration_hrs, no_show_type, topic, student_id, student_first_name, student_last_name, subjects(name, level), curricula(name), program_types(name)")
      .eq("teacher_id", teacherId)
      .gte("session_date", periodStart)
      .lte("session_date", periodEnd)
      .order("session_date", { ascending: true }),
    supabase.from("students").select("id, first_name, last_name"),
  ]);

  const studentLookup = new Map((students ?? []).map((s) => [s.id as string, `${s.first_name} ${s.last_name}`.trim()]));

  const subjectsTaught = (teacherSubjects ?? [])
    .map((ts) => {
      const subj = (ts.subjects as unknown as { name: string; level: string | null } | null);
      const curr = (ts.curricula as unknown as { name: string } | null);
      if (!subj) return null;
      const label = subjLabel(subj.name, subj.level);
      return curr ? `${curr.name} – ${label}` : label;
    })
    .filter((s): s is string => s !== null);

  const breakdownMap = new Map<string, TeacherHoursBreakdown>();
  const noShows: TeacherNoShow[] = [];
  const sessionRows: TeacherSessionRow[] = [];
  let totalHours = 0, totalSessions = 0;

  for (const s of sessions ?? []) {
    const subj = (s.subjects as unknown as { name: string; level: string | null } | null);
    const curr = (s.curricula as unknown as { name: string } | null);
    const prog = (s.program_types as unknown as { name: string } | null);
    const studentName = s.student_id
      ? (studentLookup.get(s.student_id) ?? "—")
      : (`${s.student_first_name ?? ""} ${s.student_last_name ?? ""}`.trim() || "—");
    const isNoShow = s.no_show_type !== null;
    const hrs = (s.session_duration_hrs as number) ?? 0;
    const noShowLabel = isNoShow ? (NO_SHOW_LABELS[s.no_show_type as string] ?? s.no_show_type) : null;

    sessionRows.push({
      date: s.session_date,
      studentName,
      subjectName: subj?.name ?? null,
      subjectLevel: subj?.level ?? null,
      curriculumName: curr?.name ?? null,
      programTypeName: prog?.name ?? null,
      hours: isNoShow ? null : hrs,
      topic: s.topic,
      noShowLabel,
    });

    if (isNoShow) {
      noShows.push({
        date: s.session_date,
        studentName,
        subjectName: subj?.name ?? null,
        subjectLevel: subj?.level ?? null,
        noShowLabel: noShowLabel ?? "No-show",
        noShowType: s.no_show_type as NoShowType,
      });
      continue;
    }

    totalHours += hrs;
    totalSessions++;

    const key = `${subj?.name ?? ""}|${curr?.name ?? ""}|${prog?.name ?? ""}`;
    if (!breakdownMap.has(key)) {
      breakdownMap.set(key, {
        subjectName: subj?.name ?? "—",
        subjectLevel: subj?.level ?? null,
        curriculumName: curr?.name ?? null,
        programTypeName: prog?.name ?? null,
        sessions: 0,
        hours: 0,
      });
    }
    const row = breakdownMap.get(key)!;
    row.sessions++;
    row.hours += hrs;
  }

  return {
    teacher: (teacher as Teacher) ?? null,
    subjectsTaught,
    breakdown: Array.from(breakdownMap.values()).sort((a, b) => b.hours - a.hours),
    noShows,
    sessions: sessionRows,
    totalHours,
    totalSessions,
    periodStart,
    periodEnd,
  };
}
