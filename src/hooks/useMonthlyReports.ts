import { useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import type {
  MonthlyReport, MonthlyReportTeacherStat, MonthlyReportStudentStat,
  MonthlyReportTeacherSubjectStat, MonthlyReportStudentSubjectStat, MonthlyReportSubjectStat,
} from "../types/database";

export type MonthlyReportWithStats = MonthlyReport & {
  monthly_report_teacher_stats: MonthlyReportTeacherStat[];
  monthly_report_student_stats: MonthlyReportStudentStat[];
  monthly_report_teacher_subject_stats: MonthlyReportTeacherSubjectStat[];
  monthly_report_student_subject_stats: MonthlyReportStudentSubjectStat[];
  monthly_report_subject_stats: MonthlyReportSubjectStat[];
};

type TeacherStatInput = {
  teacher_id: string | null; teacher_name: string; sessions: number; hours: number;
  no_show_payable_count: number; no_show_payout_amount: number;
};
type StudentStatInput = { student_id: string | null; student_name: string; sessions: number; hours: number };
export type TeacherSubjectStatInput = {
  teacher_id: string | null; teacher_name: string;
  subject_id: number | null; subject_name: string; subject_level: string | null;
  curriculum_id: number | null; curriculum_name: string | null;
  program_type_name: string | null;
  sessions: number; hours: number;
};
export type StudentSubjectStatInput = {
  student_id: string | null; student_name: string;
  subject_id: number | null; subject_name: string; subject_level: string | null;
  curriculum_id: number | null; curriculum_name: string | null;
  sessions: number; hours: number;
};
export type SubjectStatInput = {
  subject_id: number | null; subject_name: string; subject_level: string | null;
  curriculum_id: number | null; curriculum_name: string | null;
  sessions: number; hours: number;
};

// Pure, unit-tested in utils/lockedMonths; re-exported here for existing callers.
export { isDateInLockedMonth } from "../utils/lockedMonths";

export function useMonthlyReports() {
  const fetchReports = useCallback(async () => {
    const { data, error } = await supabase
      .from("monthly_reports")
      .select(`
        *,
        monthly_report_teacher_stats(*),
        monthly_report_student_stats(*),
        monthly_report_teacher_subject_stats(*),
        monthly_report_student_subject_stats(*),
        monthly_report_subject_stats(*)
      `)
      .order("year", { ascending: false })
      .order("month", { ascending: false });
    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as MonthlyReportWithStats[], error: null };
  }, []);

  // Which (year, month) periods are locked — used to block editing/adding
  // session logs for those months in the UI before the DB trigger has to.
  const fetchLockedMonths = useCallback(async () => {
    const { data, error } = await supabase
      .from("monthly_reports")
      .select("year, month")
      .eq("status", "locked");
    if (error) return { data: new Set<string>(), error: error.message };
    const set = new Set((data ?? []).map((r) => `${r.year}-${r.month}`));
    return { data: set, error: null };
  }, []);

  // Replaces a report's snapshot stat rows (teacher/student totals plus
  // their subject/curriculum breakdowns) with a fresh set — used both for
  // the first save and for regenerating a draft.
  async function replaceStats(
    reportId: number,
    teacherStats: TeacherStatInput[],
    studentStats: StudentStatInput[],
    teacherSubjectStats: TeacherSubjectStatInput[],
    studentSubjectStats: StudentSubjectStatInput[],
    subjectStats: SubjectStatInput[],
  ) {
    const deletes = await Promise.all([
      supabase.from("monthly_report_teacher_stats").delete().eq("report_id", reportId),
      supabase.from("monthly_report_student_stats").delete().eq("report_id", reportId),
      supabase.from("monthly_report_teacher_subject_stats").delete().eq("report_id", reportId),
      supabase.from("monthly_report_student_subject_stats").delete().eq("report_id", reportId),
      supabase.from("monthly_report_subject_stats").delete().eq("report_id", reportId),
    ]);
    const delErr = deletes.find((d) => d.error);
    if (delErr?.error) return { error: delErr.error.message };

    const [teacherIns, studentIns, teacherSubjIns, studentSubjIns, subjIns] = await Promise.all([
      teacherStats.length > 0
        ? supabase.from("monthly_report_teacher_stats").insert(teacherStats.map((s) => ({ ...s, report_id: reportId })))
        : Promise.resolve({ error: null }),
      studentStats.length > 0
        ? supabase.from("monthly_report_student_stats").insert(studentStats.map((s) => ({ ...s, report_id: reportId })))
        : Promise.resolve({ error: null }),
      teacherSubjectStats.length > 0
        ? supabase.from("monthly_report_teacher_subject_stats").insert(teacherSubjectStats.map((s) => ({ ...s, report_id: reportId })))
        : Promise.resolve({ error: null }),
      studentSubjectStats.length > 0
        ? supabase.from("monthly_report_student_subject_stats").insert(studentSubjectStats.map((s) => ({ ...s, report_id: reportId })))
        : Promise.resolve({ error: null }),
      subjectStats.length > 0
        ? supabase.from("monthly_report_subject_stats").insert(subjectStats.map((s) => ({ ...s, report_id: reportId })))
        : Promise.resolve({ error: null }),
    ]);
    const insErr = [teacherIns, studentIns, teacherSubjIns, studentSubjIns, subjIns].find((r) => r.error);
    if (insErr?.error) return { error: insErr.error.message };

    return { error: null };
  }

  // Generates (or regenerates) a draft snapshot for a month. Safe to call
  // repeatedly while still a draft — each call replaces the stored totals
  // and stat rows with a fresh pull from session_logs. Refuses to touch a
  // month that's already locked.
  const saveDraftReport = useCallback(async (opts: {
    year: number;
    month: number;
    periodStart: string;
    periodEnd: string;
    totalHours: number;
    totalSessions: number;
    uniqueStudents: number;
    noShowCount: number;
    teacherStats: TeacherStatInput[];
    studentStats: StudentStatInput[];
    teacherSubjectStats: TeacherSubjectStatInput[];
    studentSubjectStats: StudentSubjectStatInput[];
    subjectStats: SubjectStatInput[];
    generatedByUserId: string;
  }): Promise<{ error: string | null }> => {
    const { data: existing } = await supabase
      .from("monthly_reports")
      .select("id, status")
      .eq("year", opts.year)
      .eq("month", opts.month)
      .maybeSingle();

    if (existing?.status === "locked") {
      return { error: `${opts.year}-${String(opts.month).padStart(2, "0")} is already locked and can't be regenerated.` };
    }

    const totals = {
      period_start:         opts.periodStart,
      period_end:           opts.periodEnd,
      total_hours:          opts.totalHours,
      total_sessions:       opts.totalSessions,
      unique_students:      opts.uniqueStudents,
      no_show_count:        opts.noShowCount,
      generated_at:         new Date().toISOString(),
      generated_by_user_id: opts.generatedByUserId,
    };

    let reportId: number;
    if (existing) {
      reportId = existing.id;
      const { error } = await supabase.from("monthly_reports").update(totals).eq("id", reportId);
      if (error) return { error: error.message };
    } else {
      const { data: report, error } = await supabase
        .from("monthly_reports")
        .insert({ year: opts.year, month: opts.month, status: "draft", ...totals })
        .select()
        .single();
      if (error || !report) return { error: error?.message ?? "Failed to create draft" };
      reportId = (report as MonthlyReport).id;
    }

    return replaceStats(reportId, opts.teacherStats, opts.studentStats, opts.teacherSubjectStats, opts.studentSubjectStats, opts.subjectStats);
  }, []);

  // Freezes an existing draft exactly as it was last generated — locking
  // does not silently re-pull live data, so what you downloaded to check
  // is what gets locked.
  const lockDraftReport = useCallback(async (opts: { reportId: number; lockedByUserId: string }) => {
    const { data, error } = await supabase
      .from("monthly_reports")
      .update({ status: "locked", locked_at: new Date().toISOString(), locked_by_user_id: opts.lockedByUserId })
      .eq("id", opts.reportId)
      .eq("status", "draft")
      .select()
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "This report is no longer a draft — refresh and try again." };
    return { error: null };
  }, []);

  // Discards a draft outright. Locked reports are protected by a DB
  // trigger and can't be deleted this way.
  const deleteDraftReport = useCallback(async (reportId: number) => {
    const { error } = await supabase.from("monthly_reports").delete().eq("id", reportId).eq("status", "draft");
    return { error: error?.message ?? null };
  }, []);

  return { fetchReports, fetchLockedMonths, saveDraftReport, lockDraftReport, deleteDraftReport };
}
