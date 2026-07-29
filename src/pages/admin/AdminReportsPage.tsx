import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabaseClient";
import {
  useMonthlyReports, type MonthlyReportWithStats,
  type TeacherSubjectStatInput, type StudentSubjectStatInput, type SubjectStatInput,
} from "../../hooks/useMonthlyReports";
import { useInvoices } from "../../hooks/useInvoices";
import {
  buildMonthlyRevenuePdf, buildTeacherInvoicePdf, buildAllTeachersReportPdf, buildSingleInvoicePdf,
  buildFullMonthlyReportPdf, aggregateReportSections, resolveReportSection,
  type AllTeachersReportTeacher, type ReportSection, type ReportRawLine, type PackageMeta,
} from "../../utils/buildInvoicePdf";
import { ReportSectionsView } from "../../components/ui/ReportSectionsView";
import { IconSettings, IconPackage } from "../../components/ui/icons";
import {
  NO_SHOW_LABELS, subjLabel, fetchTeacherPeriodDetail, isPayableNoShow,
  type TeacherHoursBreakdown, type TeacherNoShow, type TeacherPeriodDetail, type TeacherSessionRow,
} from "../../utils/teacherPeriodDetail";
import { useNoShowSettings } from "../../hooks/useNoShowSettings";
import { useSessionDurationSettings } from "../../hooks/useSessionDurationSettings";
import { useBundlePoolSettings } from "../../hooks/useBundlePoolSettings";
import { useCoordinatorLogOptions } from "../../hooks/useCoordinatorLogOptions";
import { IconCoordinatorLog } from "../../components/ui/icons";
import type { Teacher, Student, NoShowType, BundlePoolSetting, CoordinatorLogOption, CoordinatorLogListKey } from "../../types/database";

type ReportTab = "monthly-revenue" | "reports";

interface TeacherStat {
  teacherId: string | null;
  teacherName: string;
  sessions: number;
  hours: number;
  // No Show 2 + No Show + count for this teacher this period — each one
  // pays the fixed no-show rate (see no_show_settings / useNoShowSettings).
  noShowPayableCount: number;
}

interface StudentStat {
  studentId: string | null;
  studentName: string;
  sessions: number;
  hours: number;
}

// Same shape as fetchTeacherPeriodDetail's report, but for every teacher at
// once — a handful of bulk queries plus in-memory grouping, rather than one
// round trip per teacher, so the "All Teachers Report" download stays fast.
async function fetchAllTeachersPeriodDetail(year: number, month: number): Promise<{
  periodStart: string;
  periodEnd: string;
  teachers: AllTeachersReportTeacher[];
}> {
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  const [
    { data: teachers },
    { data: teacherSubjects },
    { data: sessions },
    { data: students },
  ] = await Promise.all([
    supabase.from("teachers").select("*"),
    supabase.from("teacher_subjects").select("teacher_id, subject_id, curriculum_id, subjects(name, level), curricula(name)"),
    supabase
      .from("session_logs")
      .select("teacher_id, session_date, session_duration_hrs, no_show_type, student_id, student_first_name, student_last_name, subjects(name, level), curricula(name), program_types(name)")
      .gte("session_date", periodStart)
      .lte("session_date", periodEnd),
    supabase.from("students").select("id, first_name, last_name"),
  ]);

  const teacherLookup = new Map((teachers ?? []).map((t) => [t.id as string, t as Teacher]));
  const studentLookup = new Map((students ?? []).map((s) => [s.id as string, `${s.first_name} ${s.last_name}`.trim()]));

  const subjectsByTeacher = new Map<string, string[]>();
  for (const ts of teacherSubjects ?? []) {
    const subj = (ts.subjects as unknown as { name: string; level: string | null } | null);
    if (!subj) continue;
    const curr = (ts.curricula as unknown as { name: string } | null);
    const label = subjLabel(subj.name, subj.level);
    const list = subjectsByTeacher.get(ts.teacher_id as string) ?? [];
    list.push(curr ? `${curr.name} – ${label}` : label);
    subjectsByTeacher.set(ts.teacher_id as string, list);
  }

  interface Accum {
    breakdownMap: Map<string, TeacherHoursBreakdown>;
    noShows: TeacherNoShow[];
    totalHours: number;
    totalSessions: number;
  }
  const perTeacher = new Map<string, Accum>();

  for (const s of sessions ?? []) {
    const tid = s.teacher_id as string | null;
    if (!tid) continue;
    if (!perTeacher.has(tid)) perTeacher.set(tid, { breakdownMap: new Map(), noShows: [], totalHours: 0, totalSessions: 0 });
    const acc = perTeacher.get(tid)!;

    const subj = (s.subjects as unknown as { name: string; level: string | null } | null);
    const curr = (s.curricula as unknown as { name: string } | null);
    const prog = (s.program_types as unknown as { name: string } | null);
    const studentName = s.student_id
      ? (studentLookup.get(s.student_id) ?? "—")
      : (`${s.student_first_name ?? ""} ${s.student_last_name ?? ""}`.trim() || "—");
    const isNoShow = s.no_show_type !== null;
    const hrs = (s.session_duration_hrs as number) ?? 0;

    if (isNoShow) {
      acc.noShows.push({
        date: s.session_date,
        studentName,
        subjectName: subj?.name ?? null,
        subjectLevel: subj?.level ?? null,
        noShowLabel: NO_SHOW_LABELS[s.no_show_type as string] ?? (s.no_show_type as string),
        noShowType: s.no_show_type as NoShowType,
      });
      continue;
    }

    acc.totalHours += hrs;
    acc.totalSessions++;

    const key = `${subj?.name ?? ""}|${curr?.name ?? ""}|${prog?.name ?? ""}`;
    if (!acc.breakdownMap.has(key)) {
      acc.breakdownMap.set(key, {
        subjectName: subj?.name ?? "—",
        subjectLevel: subj?.level ?? null,
        curriculumName: curr?.name ?? null,
        programTypeName: prog?.name ?? null,
        sessions: 0,
        hours: 0,
      });
    }
    const row = acc.breakdownMap.get(key)!;
    row.sessions++;
    row.hours += hrs;
  }

  const result: AllTeachersReportTeacher[] = [];
  for (const [tid, acc] of perTeacher) {
    if (acc.totalSessions === 0 && acc.noShows.length === 0) continue;
    const teacher = teacherLookup.get(tid);
    result.push({
      id: tid,
      name: teacher ? `${teacher.first_name} ${teacher.last_name ?? ""}`.trim() : "Unknown teacher",
      email: teacher?.email ?? null,
      phone: teacher?.phone_number ?? null,
      country: teacher?.country ?? null,
      subjectsTaught: subjectsByTeacher.get(tid) ?? [],
      totalHours: acc.totalHours,
      totalSessions: acc.totalSessions,
      breakdown: Array.from(acc.breakdownMap.values()).sort((a, b) => b.hours - a.hours),
      noShows: acc.noShows,
    });
  }
  result.sort((a, b) => b.totalHours - a.totalHours);

  return { periodStart, periodEnd, teachers: result };
}

interface PeriodData {
  teacherStats: TeacherStat[];
  studentStats: StudentStat[];
  totalHours: number;
  totalSessions: number;
  // Revenue-facing figures — scoped to sessions with a course_type_id set
  // (Academic/Beyond Academic), the same billable scope packages and
  // invoices use. Demo Lessons and Offline Work never carry a course_type_id
  // and never deduct from a package, so they're excluded here even though
  // they count fully toward totalHours/totalSessions (teacher work hours).
  billableHours: number;
  billableSessions: number;
  uniqueStudents: number;
  noShowCount: number;
  error?: string;
}

function formatMonth(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return Array.from(map.entries());
}

function exportCSV(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PeriodSelector({
  year, month, years,
  onYear, onMonth,
}: {
  year: number; month: number; years: number[];
  onYear: (y: number) => void; onMonth: (m: number) => void;
}) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        value={month}
        onChange={(e) => onMonth(Number(e.target.value))}
        className="rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
      >
        {months.map((m) => (
          <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString("en-GB", { month: "long" })}</option>
        ))}
      </select>
      <select
        value={year}
        onChange={(e) => onYear(Number(e.target.value))}
        className="rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <span className="text-sm text-navy-500 font-medium">{formatMonth(year, month)}</span>
    </div>
  );
}

// ── shared data-fetcher ─────────────────────────────────────────────────────
async function fetchPeriodData(year: number, month: number): Promise<PeriodData> {
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  const [
    { data: sessions, error: sessionsError },
    { data: teachers },
    { data: students },
  ] = await Promise.all([
    supabase
      .from("session_logs")
      .select("teacher_id, session_duration_hrs, no_show_type, course_type_id, student_id, student_first_name, student_last_name")
      .gte("session_date", periodStart)
      .lte("session_date", periodEnd),
    supabase
      .from("teachers")
      .select("id, first_name, last_name"),
    supabase
      .from("students")
      .select("id, first_name, last_name"),
  ]);

  const empty: PeriodData = { teacherStats: [], studentStats: [], totalHours: 0, totalSessions: 0, billableHours: 0, billableSessions: 0, uniqueStudents: 0, noShowCount: 0 };
  if (sessionsError) return { ...empty, error: sessionsError.message };
  if (!sessions) return empty;

  const teacherNameMap = new Map<string, string>();
  for (const t of teachers ?? []) {
    teacherNameMap.set(t.id as string, `${t.first_name} ${t.last_name ?? ""}`.trim());
  }
  const studentNameMap = new Map<string, string>();
  for (const s of students ?? []) {
    studentNameMap.set(s.id as string, `${s.first_name} ${s.last_name ?? ""}`.trim());
  }

  const teacherMap = new Map<string | null, TeacherStat>();
  const studentMap = new Map<string, StudentStat>();
  let hours = 0, sessions_count = 0, billableHours = 0, billableSessions = 0, noShows = 0;
  const studentSet = new Set<string>();

  for (const s of sessions) {
    const tid = s.teacher_id as string | null;
    const sid = (s.student_id as string | null) ?? null;
    const hrs = (s.session_duration_hrs as number) ?? 0;
    const isNoShow = s.no_show_type !== null;
    // Billable = has a course_type_id (Academic/Beyond Academic) — the same
    // scope student_packages/computeHoursUsed and package invoices use. Demo
    // Lessons and Offline Work never get a course_type_id and never affect a
    // package, so they're counted in teacher hours but not in revenue.
    const isBillable = s.course_type_id != null;
    const legacyName = `${s.student_first_name ?? ""} ${s.student_last_name ?? ""}`.trim();
    const studentKey = sid ?? (legacyName ? `legacy:${legacyName}` : null);

    if (!isNoShow) {
      hours += hrs;
      sessions_count++;
      if (isBillable) {
        billableHours += hrs;
        billableSessions++;
        if (sid) studentSet.add(sid);
      }
    } else if (isBillable) {
      noShows++;
    }

    if (!teacherMap.has(tid)) {
      const name = tid ? (teacherNameMap.get(tid) ?? "Unknown teacher") : "Unknown teacher";
      teacherMap.set(tid, { teacherId: tid, teacherName: name, sessions: 0, hours: 0, noShowPayableCount: 0 });
    }
    const tStat = teacherMap.get(tid)!;
    if (!isNoShow) { tStat.sessions++; tStat.hours += hrs; }
    else if (isPayableNoShow(s.no_show_type as string | null)) { tStat.noShowPayableCount++; }

    if (!isNoShow && isBillable && studentKey) {
      if (!studentMap.has(studentKey)) {
        const name = sid ? (studentNameMap.get(sid) ?? legacyName ?? "Unknown student") : (legacyName || "Unknown student");
        studentMap.set(studentKey, { studentId: sid, studentName: name, sessions: 0, hours: 0 });
      }
      const sStat = studentMap.get(studentKey)!;
      sStat.sessions++;
      sStat.hours += hrs;
    }
  }

  const teacherStats = Array.from(teacherMap.values())
    .filter((s) => s.sessions > 0 || s.noShowPayableCount > 0)
    .sort((a, b) => b.hours - a.hours);

  const studentStats = Array.from(studentMap.values())
    .sort((a, b) => b.hours - a.hours);

  return {
    teacherStats, studentStats,
    totalHours: hours, totalSessions: sessions_count,
    billableHours, billableSessions,
    uniqueStudents: studentSet.size, noShowCount: noShows,
  };
}

// Subject/curriculum breakdown for a month, one row per (teacher, subject,
// curriculum, program) and (student, subject, curriculum) combination, plus
// a subject-only rollup independent of who taught or took the sessions —
// backs the monthly report snapshot's subject breakdowns, in addition to
// the plain per-teacher/per-student totals from fetchPeriodData.
async function fetchMonthSubjectBreakdown(year: number, month: number): Promise<{
  teacherRows: TeacherSubjectStatInput[];
  studentRows: StudentSubjectStatInput[];
  subjectRows: SubjectStatInput[];
}> {
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  const [{ data: sessions }, { data: teachers }, { data: students }] = await Promise.all([
    supabase
      .from("session_logs")
      .select("teacher_id, student_id, student_first_name, student_last_name, session_duration_hrs, no_show_type, course_type_id, subject_id, curriculum_id, subjects(name, level), curricula(name), program_types(name)")
      .gte("session_date", periodStart)
      .lte("session_date", periodEnd),
    supabase.from("teachers").select("id, first_name, last_name"),
    supabase.from("students").select("id, first_name, last_name"),
  ]);

  const teacherLookup = new Map((teachers ?? []).map((t) => [t.id as string, `${t.first_name} ${t.last_name ?? ""}`.trim()]));
  const studentLookup = new Map((students ?? []).map((s) => [s.id as string, `${s.first_name} ${s.last_name}`.trim()]));

  const teacherMap = new Map<string, TeacherSubjectStatInput>();
  const studentMap = new Map<string, StudentSubjectStatInput>();
  const subjectMap = new Map<string, SubjectStatInput>();

  for (const s of sessions ?? []) {
    if (s.no_show_type !== null) continue; // breakdown excludes no-shows, matching fetchPeriodData's convention
    const tid = s.teacher_id as string | null;
    const sid = s.student_id as string | null;
    // Student-side rows are billable only (course_type_id set), matching
    // fetchPeriodData's studentStats — teacher/subject rollups stay
    // all-inclusive since they reflect actual work, not billing.
    const isBillable = s.course_type_id != null;
    const hrs = (s.session_duration_hrs as number) ?? 0;
    const subj = s.subjects as unknown as { name: string; level: string | null } | null;
    const curr = s.curricula as unknown as { name: string } | null;
    const prog = s.program_types as unknown as { name: string } | null;
    const legacyName = `${s.student_first_name ?? ""} ${s.student_last_name ?? ""}`.trim();

    const tKey = `${tid ?? "none"}|${s.subject_id ?? ""}|${s.curriculum_id ?? ""}|${prog?.name ?? ""}`;
    if (!teacherMap.has(tKey)) {
      teacherMap.set(tKey, {
        teacher_id: tid,
        teacher_name: tid ? (teacherLookup.get(tid) ?? "Unknown teacher") : "Unknown teacher",
        subject_id: (s.subject_id as number | null) ?? null,
        subject_name: subj?.name ?? "—",
        subject_level: subj?.level ?? null,
        curriculum_id: (s.curriculum_id as number | null) ?? null,
        curriculum_name: curr?.name ?? null,
        program_type_name: prog?.name ?? null,
        sessions: 0,
        hours: 0,
      });
    }
    const trow = teacherMap.get(tKey)!;
    trow.sessions++;
    trow.hours += hrs;

    const studentKey = sid ?? (legacyName ? `legacy:${legacyName}` : null);
    if (isBillable && studentKey) {
      const sKey = `${studentKey}|${s.subject_id ?? ""}|${s.curriculum_id ?? ""}`;
      if (!studentMap.has(sKey)) {
        studentMap.set(sKey, {
          student_id: sid,
          student_name: sid ? (studentLookup.get(sid) ?? legacyName ?? "Unknown student") : (legacyName || "Unknown student"),
          subject_id: (s.subject_id as number | null) ?? null,
          subject_name: subj?.name ?? "—",
          subject_level: subj?.level ?? null,
          curriculum_id: (s.curriculum_id as number | null) ?? null,
          curriculum_name: curr?.name ?? null,
          sessions: 0,
          hours: 0,
        });
      }
      const srow = studentMap.get(sKey)!;
      srow.sessions++;
      srow.hours += hrs;
    }

    const subjKey = `${s.subject_id ?? ""}|${s.curriculum_id ?? ""}`;
    if (!subjectMap.has(subjKey)) {
      subjectMap.set(subjKey, {
        subject_id: (s.subject_id as number | null) ?? null,
        subject_name: subj?.name ?? "—",
        subject_level: subj?.level ?? null,
        curriculum_id: (s.curriculum_id as number | null) ?? null,
        curriculum_name: curr?.name ?? null,
        sessions: 0,
        hours: 0,
      });
    }
    const subjRow = subjectMap.get(subjKey)!;
    subjRow.sessions++;
    subjRow.hours += hrs;
  }

  return {
    teacherRows: Array.from(teacherMap.values()),
    studentRows: Array.from(studentMap.values()),
    subjectRows: Array.from(subjectMap.values()),
  };
}

// ── Per-student invoice-preview fetcher ─────────────────────────────────────
interface StudentNoShow {
  date: string;
  subjectName: string | null;
  subjectLevel: string | null;
  teacherName: string;
  noShowLabel: string;
}

interface StudentPeriodDetail {
  student: Student | null;
  sections: ReportSection[];
  noShows: StudentNoShow[];
  totalHours: number;
  totalSessions: number;
  periodStart: string;
  periodEnd: string;
}

// Builds the same course-type / bundle-pool → subject → teacher breakdown an
// invoice for this student/month would contain, straight from session_logs,
// so it can be previewed inline and reused to build the downloadable invoice
// PDF without a second round-trip. Uses the exact same section model
// (resolveReportSection/aggregateReportSections) as a stored invoice, so the
// preview, the generated invoice, and the PDF all agree.
async function fetchStudentPeriodDetail(studentId: string, year: number, month: number): Promise<StudentPeriodDetail> {
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  const [
    { data: student },
    { data: teachers },
    { data: packages },
    { data: courseTypes },
    { data: sessions },
  ] = await Promise.all([
    supabase.from("students").select("*").eq("id", studentId).single(),
    supabase.from("teachers").select("id, first_name, last_name"),
    supabase.from("student_packages").select("id, course_type_id, package_type_id, pool_label").eq("student_id", studentId),
    supabase.from("course_types").select("id, name"),
    supabase
      .from("session_logs")
      .select("session_date, session_duration_hrs, no_show_type, teacher_id, subject_id, curriculum_id, course_type_id, program_type_id, student_package_id, subjects(name, level), curricula(name), program_types(name)")
      .eq("student_id", studentId)
      .gte("session_date", periodStart)
      .lte("session_date", periodEnd)
      .order("session_date", { ascending: true }),
  ]);

  const teacherNameMap = new Map<string, string>();
  for (const t of teachers ?? []) {
    teacherNameMap.set(t.id as string, `${t.first_name} ${t.last_name ?? ""}`.trim());
  }
  const packageMetaById = new Map<number, PackageMeta>(
    (packages ?? []).map((p) => [p.id as number, { course_type_id: p.course_type_id as number, package_type_id: (p.package_type_id as number | null) ?? null, pool_label: (p.pool_label as string | null) ?? null }])
  );
  const courseTypeNameById = (id: number | null) =>
    (id != null ? (courseTypes ?? []).find((c) => c.id === id)?.name : undefined) ?? (id != null ? `Type ${id}` : "Other");

  const noShows: StudentNoShow[] = [];
  const rawLines: ReportRawLine[] = [];
  let totalHours = 0, totalSessions = 0;

  // This preview backs both the invoice download and the generated invoice
  // record itself, so it's scoped to billable sessions only (course_type_id
  // set) — the same scope package invoicing uses. Demo Lessons/Offline Work
  // never carry a course_type_id and are never invoiced.
  const billableSessions = (sessions ?? []).filter((s) => s.course_type_id != null);

  for (const s of billableSessions) {
    const subj = (s.subjects as unknown as { name: string; level: string | null } | null);
    const curr = (s.curricula as unknown as { name: string } | null);
    const prog = (s.program_types as unknown as { name: string } | null);
    const tid = s.teacher_id as string | null;
    const teacherName = tid ? (teacherNameMap.get(tid) ?? "Unknown teacher") : "Unknown teacher";
    const isNoShow = s.no_show_type !== null;
    const hrs = (s.session_duration_hrs as number) ?? 0;

    // A No Show + still deducts its hour from the package (see
    // utils/noShow.ts), so it counts toward totalHours and goes into
    // rawLines like any other line — just flagged isNoShow so the section
    // breakdown can show it distinctly rather than as a plain "session".
    // It's also kept in the flat `noShows` list below for the raw
    // chronological no-show log shown alongside the sectioned breakdown.
    if (isNoShow) {
      noShows.push({
        date: s.session_date,
        subjectName: subj?.name ?? null,
        subjectLevel: subj?.level ?? null,
        teacherName,
        noShowLabel: NO_SHOW_LABELS[s.no_show_type as string] ?? (s.no_show_type as string),
      });
    } else {
      totalSessions++;
    }

    totalHours += hrs;
    rawLines.push({
      student_package_id: (s.student_package_id as number | null) ?? null,
      course_type_id: (s.course_type_id as number | null) ?? null,
      subject_id: s.subject_id as number | null,
      subjectName: subj?.name ?? null,
      subjectLevel: subj?.level ?? null,
      curriculumName: curr?.name ?? null,
      program_type_id: (s.program_type_id as number | null) ?? null,
      programTypeName: prog?.name ?? null,
      teacherName,
      hours: hrs,
      session_count: 1,
      isNoShow,
    });
  }

  const sections = aggregateReportSections(rawLines, (spid, ctid) => resolveReportSection(spid, ctid, packageMetaById, courseTypeNameById));

  return { student: (student as Student) ?? null, sections, noShows, totalHours, totalSessions, periodStart, periodEnd };
}

// ── Student hours drill-down row ────────────────────────────────────────────
function StudentHourRow({ stat, year, month }: { stat: StudentStat; year: number; month: number }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { generateInvoice } = useInvoices();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<StudentPeriodDetail | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function ensureDetail() {
    if (detail || !stat.studentId) return detail;
    setLoading(true);
    const d = await fetchStudentPeriodDetail(stat.studentId, year, month);
    setDetail(d);
    setLoading(false);
    return d;
  }

  async function toggle() {
    if (!stat.studentId) return;
    if (!expanded) await ensureDetail();
    setExpanded((v) => !v);
  }

  function goToStudent() {
    if (stat.studentId) navigate(`/admin/students/${stat.studentId}?tab=packages`);
  }

  async function handleDownloadInvoice() {
    if (!stat.studentId || !profile) return;
    setDownloading(true);
    const d = await ensureDetail();
    if (d?.student) {
      await generateInvoice({
        studentId: stat.studentId,
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        generatedByUserId: profile.id,
      });
      buildSingleInvoicePdf({
        student: d.student,
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        totalHours: d.totalHours,
        sections: d.sections,
      });
    }
    setDownloading(false);
  }

  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 px-5 py-3 hover:bg-navy-50">
        <button
          type="button"
          onClick={goToStudent}
          disabled={!stat.studentId}
          title="View this student's actual hours"
          className={`text-sm font-medium text-left text-navy-700 truncate ${stat.studentId ? "hover:text-sky-600 hover:underline" : "cursor-default"}`}
        >
          {stat.studentName}
        </button>
        <span className="text-sm text-navy-600 w-16 text-center">{stat.sessions}</span>
        <span className="text-sm font-bold text-navy-700 w-20 text-right">{stat.hours.toFixed(1)} hrs</span>
        <button
          type="button"
          onClick={handleDownloadInvoice}
          disabled={!stat.studentId || downloading}
          className="text-xs text-sky-500 hover:text-sky-700 whitespace-nowrap disabled:opacity-50"
        >
          {downloading ? "Preparing…" : "Download report"}
        </button>
        <button type="button" onClick={toggle} disabled={!stat.studentId} className="text-navy-300 text-xs w-4 text-right">
          {stat.studentId ? (expanded ? "▲" : "▼") : ""}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-navy-50 bg-navy-50/40">
          {loading || !detail ? (
            <div className="flex items-center gap-2 text-navy-300 text-sm px-5 py-4"><Spinner /> Loading report details…</div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* Report preview: hours by package section → subject → teacher */}
              <div>
                <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2">Report Preview — Hours by Package</p>
                <ReportSectionsView sections={detail.sections} />
              </div>

              {/* No-shows */}
              {detail.noShows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2">No-Show Sessions</p>
                  <div className="bg-white rounded-xl border border-navy-50 overflow-hidden">
                    <div className="grid grid-cols-3 px-4 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide bg-amber-50">
                      <span>Date</span><span>Teacher</span><span>Subject</span>
                    </div>
                    {detail.noShows.map((n, i) => (
                      <div key={i} className="grid grid-cols-3 px-4 py-2 border-t border-navy-50 text-sm items-center">
                        <span className="text-navy-600">{new Date(n.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
                        <span className="text-navy-700">{n.teacherName}</span>
                        <span className="text-navy-600">{subjLabel(n.subjectName, n.subjectLevel)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Settings tab — shared building blocks ───────────────────────────────
// Every admin-editable constant on this tab (no-show payout rate, no-show
// duration, each bundle pool's hours) renders through the same SettingRow:
// a bordered row with a label/description on the left, and either the
// current value + "Edit" (view mode) or the input(s) + Save/Cancel (edit
// mode) on the right — one consistent look instead of each control
// inventing its own bare "label: value … Edit" line.
function SettingRow({
  label, editing, onEdit, onCancel, onSave, saving, error, valueDisplay, children,
}: {
  label: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  valueDisplay: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-navy-50 first:border-t-0">
      <p className="text-sm font-medium text-navy-700">{label}</p>
      {editing ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {children}
          <Button size="sm" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          <button type="button" onClick={onCancel} className="text-xs text-navy-400 hover:text-navy-600 font-medium">Cancel</button>
          {error && <span className="w-full text-right text-xs text-red-600">{error}</span>}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-navy-800">{valueDisplay}</span>
          <button type="button" onClick={onEdit} className="text-xs text-sky-500 hover:text-sky-700 font-semibold">Edit</button>
        </div>
      )}
    </div>
  );
}

// A titled card grouping related SettingRows into a compact table.
function SettingsSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-navy-50 bg-navy-50/40">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-navy-800">{title}</h3>
      </div>
      <div className="flex flex-col">{children}</div>
    </Card>
  );
}

// Editor for the fixed no-show payout rate (no_show_settings.payout_amount).
function NoShowRateEditor() {
  const { profile } = useAuth();
  const { settings, updatePayoutAmount } = useNoShowSettings();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setValue(settings ? String(settings.payout_amount) : "30");
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (!profile) return;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter a valid amount.");
      return;
    }
    setSaving(true);
    const { error } = await updatePayoutAmount(amount, profile.id);
    setSaving(false);
    if (error) { setError(error); return; }
    setEditing(false);
  }

  if (!settings) return null;

  return (
    <SettingRow
      label="No-show payout rate"
      editing={editing}
      onEdit={startEdit}
      onCancel={() => setEditing(false)}
      onSave={save}
      saving={saving}
      error={error}
      valueDisplay={`${settings.payout_amount} ${settings.currency}`}
    >
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-24 rounded-lg border border-navy-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
      />
      <span className="text-sm text-navy-400">{settings.currency}</span>
    </SettingRow>
  );
}

// Editor for the default No Show + duration (session_duration_settings) —
// the fixed number of hours cut from a student's package for every No Show
// + log; applied automatically in SessionLogFormView, never typed in there.
function SessionDurationEditor() {
  const { profile } = useAuth();
  const { settings, updateDefaultDuration } = useSessionDurationSettings();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setValue(settings ? String(settings.default_duration_hrs) : "1");
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (!profile) return;
    const hrs = Number(value);
    if (!Number.isFinite(hrs) || hrs <= 0 || Math.round(hrs * 4) !== hrs * 4) {
      setError("Enter a valid duration in 15-minute increments (e.g. 1, 1.25, 1.5).");
      return;
    }
    setSaving(true);
    const { error } = await updateDefaultDuration(hrs, profile.id);
    setSaving(false);
    if (error) { setError(error); return; }
    setEditing(false);
  }

  if (!settings) return null;

  return (
    <SettingRow
      label="Default No Show + duration"
      editing={editing}
      onEdit={startEdit}
      onCancel={() => setEditing(false)}
      onSave={save}
      saving={saving}
      error={error}
      valueDisplay={`${settings.default_duration_hrs} hrs`}
    >
      <input
        type="number"
        min="0.25"
        step="0.25"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-20 rounded-lg border border-navy-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
      />
      <span className="text-sm text-navy-400">hrs</span>
    </SettingRow>
  );
}

// Editor for one Foundation Program / All-In-One pool's hours
// (bundle_pool_settings.hours) — editable ONLY here; every other consumer
// (AdminEnrollStudentPage's bundle preview, the review-enrollment-payment
// edge function) only reads this table.
function BundlePoolHourRow({
  pool, profile, updateHours,
}: {
  pool: BundlePoolSetting;
  profile: { id: string } | null;
  updateHours: (id: number, hours: number, updatedByUserId: string) => Promise<{ error: string | null }>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setValue(String(pool.hours));
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (!profile) return;
    const hrs = Number(value);
    if (!Number.isFinite(hrs) || hrs <= 0) {
      setError("Enter a valid number of hours.");
      return;
    }
    setSaving(true);
    const { error } = await updateHours(pool.id, hrs, profile.id);
    setSaving(false);
    if (error) { setError(error); return; }
    setEditing(false);
  }

  return (
    <SettingRow
      label={pool.pool_label ?? pool.course_type_name}
      editing={editing}
      onEdit={startEdit}
      onCancel={() => setEditing(false)}
      onSave={save}
      saving={saving}
      error={error}
      valueDisplay={`${pool.hours} hrs`}
    >
      <input
        type="number"
        min="0.25"
        step="0.25"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-20 rounded-lg border border-navy-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
      />
      <span className="text-sm text-navy-400">hrs</span>
    </SettingRow>
  );
}

// One section per bundle (Foundation Program / All-In-One), listing every
// pool it fans out into on purchase, with its hours editable inline.
function BundlePoolSettingsSection({ bundleName }: { bundleName: "Foundation Program" | "All-In-One" }) {
  const { profile } = useAuth();
  const { settings, loading, updateHours } = useBundlePoolSettings();
  const pools = settings.filter((s) => s.bundle_name === bundleName);

  if (loading && pools.length === 0) return null;

  return (
    <SettingsSection
      icon={<IconPackage />}
      title={`${bundleName} hours`}
    >
      {pools.map((pool) => (
        <BundlePoolHourRow key={pool.id} pool={pool} profile={profile} updateHours={updateHours} />
      ))}
    </SettingsSection>
  );
}

// Add/rename/reorder/deactivate editor for one of the 6 Coordinator Log
// dropdown option lists (Primary Goal, Progress Status, Biggest Challenge,
// Next Action, Renewal Status, Referral Status) — all 6 share the same
// coordinator_log_options table (discriminated by listKey), so one component
// covers every list. Plain text only, no per-option color (matches every
// other admin-editable list in this app, e.g. Program Types).
function CoordinatorLogOptionListSection({
  listKey, title,
}: {
  listKey: CoordinatorLogListKey;
  title: string;
}) {
  const { profile } = useAuth();
  const { options, createOption, updateOption } = useCoordinatorLogOptions(listKey);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  const sorted = [...options].sort((a, b) => a.sort_order - b.sort_order);

  async function handleAdd() {
    if (!newLabel.trim() || !profile) return;
    setAdding(true);
    setAddError(null);
    const { error } = await createOption(newLabel.trim(), profile.id);
    setAdding(false);
    if (error) setAddError(error);
    else setNewLabel("");
  }

  function startEdit(o: CoordinatorLogOption) {
    setEditingId(o.id);
    setEditValue(o.label);
  }

  async function saveEdit(o: CoordinatorLogOption) {
    if (!profile || !editValue.trim()) return;
    setSavingId(o.id);
    await updateOption(o.id, { label: editValue.trim() }, profile.id);
    setSavingId(null);
    setEditingId(null);
  }

  async function toggleActive(o: CoordinatorLogOption) {
    if (!profile) return;
    setSavingId(o.id);
    await updateOption(o.id, { is_active: !o.is_active }, profile.id);
    setSavingId(null);
  }

  async function move(o: CoordinatorLogOption, direction: -1 | 1) {
    if (!profile) return;
    const idx = sorted.findIndex((x) => x.id === o.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx];
    setSavingId(o.id);
    await Promise.all([
      updateOption(o.id, { sort_order: other.sort_order }, profile.id),
      updateOption(other.id, { sort_order: o.sort_order }, profile.id),
    ]);
    setSavingId(null);
  }

  return (
    <SettingsSection icon={<IconCoordinatorLog />} title={title}>
      {sorted.map((o, i) => (
        <div key={o.id} className="flex items-center justify-between gap-3 px-3 py-2 border-t border-navy-50 first:border-t-0">
          {editingId === o.id ? (
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              autoFocus
              className="flex-1 rounded-lg border border-navy-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
          ) : (
            <span className={`text-sm font-medium ${o.is_active ? "text-navy-700" : "text-navy-300 line-through"}`}>{o.label}</span>
          )}
          <div className="flex items-center gap-2.5 shrink-0">
            <button type="button" onClick={() => move(o, -1)} disabled={i === 0 || savingId === o.id} className="text-navy-300 hover:text-navy-600 disabled:opacity-30 text-xs">▲</button>
            <button type="button" onClick={() => move(o, 1)} disabled={i === sorted.length - 1 || savingId === o.id} className="text-navy-300 hover:text-navy-600 disabled:opacity-30 text-xs">▼</button>
            {editingId === o.id ? (
              <>
                <button type="button" onClick={() => saveEdit(o)} disabled={savingId === o.id} className="text-xs text-sky-500 hover:text-sky-700 font-semibold">Save</button>
                <button type="button" onClick={() => setEditingId(null)} className="text-xs text-navy-400 hover:text-navy-600 font-medium">Cancel</button>
              </>
            ) : (
              <button type="button" onClick={() => startEdit(o)} className="text-xs text-sky-500 hover:text-sky-700 font-semibold">Edit</button>
            )}
            <button type="button" onClick={() => toggleActive(o)} disabled={savingId === o.id} className="text-xs text-navy-400 hover:text-navy-600 font-semibold whitespace-nowrap">
              {o.is_active ? "Deactivate" : "Activate"}
            </button>
          </div>
        </div>
      ))}
      <div className="flex gap-2 items-center px-3 py-2 border-t border-navy-50">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Add option…"
          className="flex-1 rounded-lg border border-navy-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        <Button size="sm" onClick={handleAdd} disabled={adding || !newLabel.trim()}>{adding ? "Adding…" : "+ Add"}</Button>
      </div>
      {addError && <p className="px-3 pb-2 text-xs text-red-600">{addError}</p>}
    </SettingsSection>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────────
// Every admin-editable constant in the app, grouped into sections: the
// no-show rules (payout rate + duration), each bundle's per-pool hours, and
// (added for Coordinator Logs) the 6 dropdown option lists that feature
// uses. These used to be scattered (payout rate at the top of Teacher Hours,
// duration at the top of the Session Logs list, bundle hours hardcoded in
// source with no UI at all) — consolidated here as the one place to change
// any of them.
// Exported so it can be rendered as its own standalone page
// (`AdminSettingsPage` at /admin/settings, under the sidebar's "Configuration"
// group) — it used to live as a sub-tab of the Reports page.
export function SettingsTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <SettingsSection icon={<IconSettings />} title="No-show rules">
          <NoShowRateEditor />
          <SessionDurationEditor />
        </SettingsSection>
        <BundlePoolSettingsSection bundleName="Foundation Program" />
        <BundlePoolSettingsSection bundleName="All-In-One" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-navy-800 mb-3">Performance Coach Log options</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <CoordinatorLogOptionListSection listKey="primary_goal" title="Primary Goal" />
          <CoordinatorLogOptionListSection listKey="progress_status" title="Progress Status" />
          <CoordinatorLogOptionListSection listKey="biggest_challenge" title="Biggest Challenge" />
          <CoordinatorLogOptionListSection listKey="next_action" title="Next Action" />
          <CoordinatorLogOptionListSection listKey="renewal_status" title="Renewal Status" />
          <CoordinatorLogOptionListSection listKey="referral_status" title="Referral Status" />
        </div>
      </div>
    </div>
  );
}

// ── Teacher Hours drill-down row ────────────────────────────────────────────
function TeacherHourRow({ stat, year, month, payoutRate, currency }: { stat: TeacherStat; year: number; month: number; payoutRate: number; currency: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<TeacherPeriodDetail | null>(null);
  const [downloading, setDownloading] = useState<"report" | "logs" | null>(null);

  async function toggle() {
    if (!stat.teacherId) return;
    if (!expanded && !detail) {
      setLoading(true);
      const d = await fetchTeacherPeriodDetail(stat.teacherId, year, month);
      setDetail(d);
      setLoading(false);
    }
    setExpanded((v) => !v);
  }

  // Runs the (synchronous) PDF/CSV build off the click handler's stack via
  // setTimeout, so the "Preparing…" button state paints first and the UI
  // thread isn't blocked mid-click — the file simply appears once ready.
  function handleDownloadInvoice() {
    if (!detail?.teacher) return;
    setDownloading("report");
    setTimeout(() => {
      buildTeacherInvoicePdf({
        teacher: {
          id: detail.teacher!.id,
          name: `${detail.teacher!.first_name} ${detail.teacher!.last_name ?? ""}`.trim(),
          email: detail.teacher!.email,
          phone: detail.teacher!.phone_number,
          country: detail.teacher!.country,
          subjectsTaught: detail.subjectsTaught,
        },
        periodStart: detail.periodStart,
        periodEnd: detail.periodEnd,
        totalHours: detail.totalHours,
        totalSessions: detail.totalSessions,
        breakdown: detail.breakdown,
        noShows: detail.noShows,
      });
      setDownloading(null);
    }, 0);
  }

  function handleDownloadSessionLogs() {
    if (!detail) return;
    setDownloading("logs");
    setTimeout(() => {
      const rows = [
        ["Date", "Student", "Subject", "Curriculum", "Program", "Duration (hrs)", "Status", "Topic"],
        ...detail.sessions.map((s) => [
          new Date(s.date).toLocaleDateString("en-GB"),
          s.studentName,
          subjLabel(s.subjectName, s.subjectLevel),
          s.curriculumName ?? "",
          s.programTypeName ?? "",
          s.hours != null ? s.hours.toFixed(2) : "",
          s.noShowLabel ?? "Completed",
          s.topic ?? "",
        ]),
      ];
      exportCSV(rows, `session-logs_${stat.teacherName.replace(/\s+/g, "-")}_${year}-${String(month).padStart(2, "0")}.csv`);
      setDownloading(null);
    }, 0);
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={!stat.teacherId}
        className={`w-full grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 px-5 py-3 text-left ${stat.teacherId ? "hover:bg-navy-50 cursor-pointer" : "cursor-default"}`}
      >
        <span className="text-sm font-medium text-navy-700">{stat.teacherName}</span>
        <span className="text-sm text-navy-600 w-20 text-center">{stat.sessions}</span>
        <span className="text-sm font-bold text-navy-700 w-24 text-right">{stat.hours.toFixed(1)} hrs</span>
        <span className="text-sm text-navy-600 w-36 text-right">
          {stat.noShowPayableCount > 0
            ? <>{stat.noShowPayableCount} × {payoutRate} {currency} = <span className="font-bold text-amber-600">{(stat.noShowPayableCount * payoutRate).toFixed(2)} {currency}</span></>
            : <span className="text-navy-300">—</span>}
        </span>
        <span className="text-navy-300 text-xs w-4 text-right">{stat.teacherId ? (expanded ? "▲" : "▼") : ""}</span>
      </button>

      {expanded && (
        <div className="border-t border-navy-50 bg-navy-50/40">
          {loading || !detail ? (
            <div className="flex items-center gap-2 text-navy-300 text-sm px-5 py-4"><Spinner /> Loading report…</div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* Teacher details */}
              <div>
                <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2">Teacher Details</p>
                <div className="bg-white rounded-xl border border-navy-50 p-3 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                    <div><span className="text-navy-400">Email: </span><span className="text-navy-700 font-medium">{detail.teacher?.email ?? "—"}</span></div>
                    <div><span className="text-navy-400">Phone: </span><span className="text-navy-700 font-medium">{detail.teacher?.phone_number ?? "—"}</span></div>
                    <div><span className="text-navy-400">Country: </span><span className="text-navy-700 font-medium">{detail.teacher?.country ?? "—"}</span></div>
                  </div>
                  {/* Subjects taught intentionally not shown here — still
                      included in the downloadable report/PDF below (see
                      handleDownloadInvoice). */}
                </div>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-3 gap-3 max-w-md">
                <div className="bg-white rounded-xl border border-navy-50 p-3 text-center">
                  <p className="text-lg font-bold text-navy-700">{detail.totalHours.toFixed(1)}</p>
                  <p className="text-xs text-sky-500 font-semibold">Hours</p>
                </div>
                <div className="bg-white rounded-xl border border-navy-50 p-3 text-center">
                  <p className="text-lg font-bold text-navy-700">{detail.totalSessions}</p>
                  <p className="text-xs text-sky-500 font-semibold">Sessions</p>
                </div>
                <div className="bg-white rounded-xl border border-navy-50 p-3 text-center">
                  <p className="text-lg font-bold text-navy-700">{detail.noShows.length}</p>
                  <p className="text-xs text-amber-600 font-semibold">No-shows</p>
                </div>
              </div>

              {/* Breakdown table */}
              <div>
                <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2">Hours by Subject &amp; Program</p>
                <div className="bg-white rounded-xl border border-navy-50 overflow-hidden">
                  <div className="grid grid-cols-5 px-4 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide bg-navy-50">
                    <span className="col-span-2">Subject</span>
                    <span>Program</span>
                    <span className="text-center">Sessions</span>
                    <span className="text-right">Hours</span>
                  </div>
                  {detail.breakdown.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-navy-400">No sessions logged.</p>
                  ) : detail.breakdown.map((b, i) => (
                    <div key={i} className="grid grid-cols-5 px-4 py-2 border-t border-navy-50 text-sm">
                      <span className="col-span-2 font-medium text-navy-700">
                        {subjLabel(b.subjectName, b.subjectLevel)}{b.curriculumName ? ` · ${b.curriculumName}` : ""}
                      </span>
                      <span className="text-navy-600">{b.programTypeName ?? "—"}</span>
                      <span className="text-center text-navy-600">{b.sessions}</span>
                      <span className="text-right font-semibold text-navy-700">{b.hours.toFixed(2)} hrs</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* No-shows table */}
              <div>
                <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2">No-Show Sessions</p>
                <div className="bg-white rounded-xl border border-navy-50 overflow-hidden">
                  <div className="grid grid-cols-4 px-4 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide bg-amber-50">
                    <span>Date</span><span>Student</span><span>Subject</span><span>Type</span>
                  </div>
                  {detail.noShows.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-navy-400">No no-shows this period.</p>
                  ) : detail.noShows.map((n, i) => (
                    <div key={i} className="grid grid-cols-4 px-4 py-2 border-t border-navy-50 text-sm items-center">
                      <span className="text-navy-600">{new Date(n.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
                      <span className="text-navy-700 font-medium">{n.studentName}</span>
                      <span className="text-navy-600">{subjLabel(n.subjectName, n.subjectLevel)}</span>
                      <span>
                        <span className="inline-block rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-semibold">
                          {n.noShowLabel}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Downloads */}
              <div className="flex gap-2 pt-1 flex-wrap">
                <Button size="sm" onClick={handleDownloadInvoice} disabled={downloading !== null}>
                  {downloading === "report" ? "Preparing…" : "Download Hours (PDF)"}
                </Button>
                <Button size="sm" variant="secondary" onClick={handleDownloadSessionLogs} disabled={downloading !== null}>
                  {downloading === "logs" ? "Preparing…" : "Download Session Logs (CSV)"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Teacher Hours tab ────────────────────────────────────────────────────────
// Exported so it can be rendered as its own standalone page
// (`AdminTeacherHoursPage` at /admin/teacher-hours, under the sidebar's
// "Teachers" group) — it used to live as a sub-tab of the Reports page.
export function TeacherHoursTab({ years }: { years: number[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PeriodData | null>(null);
  const [search, setSearch] = useState("");
  const [generatingReport, setGeneratingReport] = useState(false);
  const { settings: noShowSettings } = useNoShowSettings();
  const payoutRate = noShowSettings?.payout_amount ?? 30;
  const payoutCurrency = noShowSettings?.currency ?? "SGD";

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchPeriodData(year, month);
    setData(d);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const filtered = (data?.teacherStats ?? []).filter((s) =>
    !search || s.teacherName.toLowerCase().includes(search.toLowerCase())
  );

  function handleExport() {
    if (!data) return;
    const rows = [
      ["Teacher", "Sessions", "Hours", "Payable no-shows", `Payout (${payoutCurrency})`],
      ...data.teacherStats.map((s) => [
        s.teacherName, String(s.sessions), s.hours.toFixed(1),
        String(s.noShowPayableCount), (s.noShowPayableCount * payoutRate).toFixed(2),
      ]),
      ["Total", String(data.totalSessions), data.totalHours.toFixed(1),
        String(data.teacherStats.reduce((sum, s) => sum + s.noShowPayableCount, 0)),
        (data.teacherStats.reduce((sum, s) => sum + s.noShowPayableCount, 0) * payoutRate).toFixed(2)],
    ];
    exportCSV(rows, `teacher-hours-${year}-${String(month).padStart(2, "0")}.csv`);
  }

  // Fetches every teacher's full report for the period, then builds the PDF
  // off the stack (see TeacherHourRow's download handlers for why) so the
  // "Generating…" state paints before the multi-page PDF build runs.
  async function handleDownloadAllTeachersReport() {
    setGeneratingReport(true);
    const detail = await fetchAllTeachersPeriodDetail(year, month);
    setTimeout(() => {
      buildAllTeachersReportPdf(detail);
      setGeneratingReport(false);
    }, 0);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PeriodSelector year={year} month={month} years={years} onYear={setYear} onMonth={setMonth} />
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={handleDownloadAllTeachersReport}
            disabled={!data || data.teacherStats.length === 0 || generatingReport}
          >
            {generatingReport ? "Generating…" : "Download Full Report (All Teachers)"}
          </Button>
          <Button onClick={handleExport} disabled={!data || data.teacherStats.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>

      <div className="max-w-xs">
        <input
          type="text"
          placeholder="Search teacher…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      ) : data?.error ? (
        <Card className="p-6">
          <p className="text-sm text-red-600">Error loading data: {data.error}</p>
          <button onClick={load} className="mt-2 text-sm text-sky-500 hover:text-sky-700">Retry</button>
        </Card>
      ) : !data || data.teacherStats.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-navy-400">No sessions logged for {formatMonth(year, month)}.</p>
        </Card>
      ) : (
        <Card>
          <div className="px-5 py-4 border-b border-navy-50">
            <p className="font-semibold text-navy-700">Teacher Hours — {formatMonth(year, month)}</p>
            <p className="text-xs text-navy-400 mt-0.5">No-show sessions excluded from totals (No Show + still deducts from the student's package) · click a teacher for their full report</p>
          </div>
          <div className="divide-y divide-navy-50">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-5 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide">
              <span>Teacher</span>
              <span className="w-20 text-center">Sessions</span>
              <span className="w-24 text-right">Hours</span>
              <span className="w-36 text-right">No-show payout</span>
              <span className="w-4"></span>
            </div>
            {filtered.map((stat, i) => (
              <TeacherHourRow key={stat.teacherId ?? `unknown-${i}`} stat={stat} year={year} month={month} payoutRate={payoutRate} currency={payoutCurrency} />
            ))}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-5 py-3 bg-navy-50">
              <span className="text-sm font-bold text-navy-700">Total</span>
              <span className="text-sm font-bold text-navy-700 w-20 text-center">{data.totalSessions}</span>
              <span className="text-sm font-bold text-sky-600 w-24 text-right">{data.totalHours.toFixed(1)} hrs</span>
              <span className="text-sm font-bold text-amber-600 w-36 text-right">
                {(data.teacherStats.reduce((sum, s) => sum + s.noShowPayableCount, 0) * payoutRate).toFixed(2)} {payoutCurrency}
              </span>
              <span className="w-4"></span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Monthly Revenue tab ──────────────────────────────────────────────────────
function MonthlyRevenueTab({ years }: { years: number[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PeriodData | null>(null);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchPeriodData(year, month);
    setData(d);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const filteredStudents = (data?.studentStats ?? []).filter((s) =>
    !search || s.studentName.toLowerCase().includes(search.toLowerCase())
  );

  function handleExport() {
    if (!data) return;
    const rows = [
      [formatMonth(year, month), ""],
      ["Metric", "Value"],
      ["Total Hours", data.billableHours.toFixed(1)],
      ["Sessions", String(data.billableSessions)],
      ["Active Students", String(data.uniqueStudents)],
      ["No-shows", String(data.noShowCount)],
      ["", ""],
      ["Student", "Sessions", "Hours"],
      ...data.studentStats.map((s) => [s.studentName, String(s.sessions), s.hours.toFixed(1)]),
      ["Total", String(data.billableSessions), data.billableHours.toFixed(1)],
    ];
    exportCSV(rows, `monthly-revenue-${year}-${String(month).padStart(2, "0")}.csv`);
  }

  function handleGenerateReport() {
    if (!data) return;
    setGenerating(true);
    try {
      buildMonthlyRevenuePdf({
        year,
        month,
        totalHours: data.billableHours,
        totalSessions: data.billableSessions,
        uniqueStudents: data.uniqueStudents,
        noShowCount: data.noShowCount,
        studentStats: data.studentStats.map((s) => ({ studentName: s.studentName, sessions: s.sessions, hours: s.hours })),
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PeriodSelector year={year} month={month} years={years} onYear={setYear} onMonth={setMonth} />
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={handleExport} disabled={!data}>Export CSV</Button>
          <Button onClick={handleGenerateReport} disabled={!data || generating}>
            {generating ? "Generating…" : "Generate Report"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      ) : data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Hours",      value: data.billableHours.toFixed(1),  sub: "billable hrs delivered" },
            { label: "Sessions",         value: data.billableSessions,           sub: "logged" },
            { label: "Active Students",  value: data.uniqueStudents,          sub: "this month" },
            { label: "No-shows",         value: data.noShowCount,             sub: "sessions missed" },
          ].map(({ label, value, sub }) => (
            <Card key={label} className="p-4 text-center">
              <p className="text-2xl font-bold text-navy-700">{value}</p>
              <p className="text-xs text-sky-500 font-semibold mt-0.5">{label}</p>
              <p className="text-xs text-navy-400">{sub}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="max-w-xs">
        <input
          type="text"
          placeholder="Search student…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
      </div>

      {loading ? null : data?.error ? (
        <Card className="p-6">
          <p className="text-sm text-red-600">Error loading data: {data.error}</p>
          <button onClick={load} className="mt-2 text-sm text-sky-500 hover:text-sky-700">Retry</button>
        </Card>
      ) : !data || data.studentStats.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-navy-400">No sessions logged for {formatMonth(year, month)}.</p>
        </Card>
      ) : (
        <Card>
          <div className="px-5 py-4 border-b border-navy-50">
            <p className="font-semibold text-navy-700">Student Hours Breakdown — {formatMonth(year, month)}</p>
            <p className="text-xs text-navy-400 mt-0.5">No-show and non-billable (Demo Lesson / Offline Work) sessions excluded · click a student to view their actual hours</p>
          </div>
          <div className="divide-y divide-navy-50">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-5 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide">
              <span>Student</span>
              <span className="w-16 text-center">Sessions</span>
              <span className="w-20 text-right">Hours</span>
              <span className="w-28"></span>
              <span className="w-4"></span>
            </div>
            {filteredStudents.map((stat, i) => (
              <StudentHourRow key={stat.studentId ?? i} stat={stat} year={year} month={month} />
            ))}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-5 py-3 bg-navy-50">
              <span className="text-sm font-bold text-navy-700">Total</span>
              <span className="text-sm font-bold text-navy-700 w-16 text-center">{data.billableSessions}</span>
              <span className="text-sm font-bold text-sky-600 w-20 text-right">{data.billableHours.toFixed(1)} hrs</span>
              <span className="w-28"></span>
              <span className="w-4"></span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

interface MonthSessionRow extends TeacherSessionRow {
  teacherName: string;
}

// Full raw per-session list across every teacher for a month — backs the
// Reports tab's "Download Session Logs" option (available for both drafts
// and locked reports).
async function fetchMonthSessionLogRows(year: number, month: number): Promise<MonthSessionRow[]> {
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

  const [{ data: sessions }, { data: teachers }, { data: students }] = await Promise.all([
    supabase
      .from("session_logs")
      .select("teacher_id, session_date, session_duration_hrs, no_show_type, topic, student_id, student_first_name, student_last_name, subjects(name, level), curricula(name), program_types(name)")
      .gte("session_date", periodStart)
      .lte("session_date", periodEnd)
      .order("session_date", { ascending: true }),
    supabase.from("teachers").select("id, first_name, last_name"),
    supabase.from("students").select("id, first_name, last_name"),
  ]);

  const teacherLookup = new Map((teachers ?? []).map((t) => [t.id as string, `${t.first_name} ${t.last_name ?? ""}`.trim()]));
  const studentLookup = new Map((students ?? []).map((s) => [s.id as string, `${s.first_name} ${s.last_name}`.trim()]));

  return (sessions ?? []).map((s) => {
    const subj = (s.subjects as unknown as { name: string; level: string | null } | null);
    const curr = (s.curricula as unknown as { name: string } | null);
    const prog = (s.program_types as unknown as { name: string } | null);
    const tid = s.teacher_id as string | null;
    const isNoShow = s.no_show_type !== null;
    const hrs = (s.session_duration_hrs as number) ?? 0;
    const studentName = s.student_id
      ? (studentLookup.get(s.student_id) ?? "—")
      : (`${s.student_first_name ?? ""} ${s.student_last_name ?? ""}`.trim() || "—");
    return {
      date: s.session_date,
      teacherName: tid ? (teacherLookup.get(tid) ?? "Unknown teacher") : "Unknown teacher",
      studentName,
      subjectName: subj?.name ?? null,
      subjectLevel: subj?.level ?? null,
      curriculumName: curr?.name ?? null,
      programTypeName: prog?.name ?? null,
      hours: isNoShow ? null : hrs,
      topic: s.topic,
      noShowLabel: isNoShow ? (NO_SHOW_LABELS[s.no_show_type as string] ?? s.no_show_type) : null,
    };
  });
}

function exportMonthSessionLogsCsv(rows: MonthSessionRow[], year: number, month: number) {
  const csvRows = [
    ["Date", "Teacher", "Student", "Subject", "Curriculum", "Program", "Duration (hrs)", "Status", "Topic"],
    ...rows.map((r) => [
      new Date(r.date).toLocaleDateString("en-GB"),
      r.teacherName,
      r.studentName,
      subjLabel(r.subjectName, r.subjectLevel),
      r.curriculumName ?? "",
      r.programTypeName ?? "",
      r.hours != null ? r.hours.toFixed(2) : "",
      r.noShowLabel ?? "Completed",
      r.topic ?? "",
    ]),
  ];
  exportCSV(csvRows, `session-logs_${year}-${String(month).padStart(2, "0")}.csv`);
}

// ── Report card — shared shell for a draft or a locked report row ──────────
function ReportCard({
  report, expanded, onToggleExpand, badge, actions, footerNote,
}: {
  report: MonthlyReportWithStats;
  expanded: boolean;
  onToggleExpand: () => void;
  badge: React.ReactNode;
  actions: React.ReactNode;
  footerNote: string;
}) {
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);

  const entityKey = (id: number | string | null, name: string | null) => `${id ?? "none"}|${name ?? ""}`;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 flex-wrap gap-2">
        <div>
          <span className="font-semibold text-navy-700">{formatMonth(report.year, report.month)}</span>
          <span className="ml-3 text-sm text-navy-500">
            {report.total_hours.toFixed(1)} hrs · {report.total_sessions} sessions · {report.unique_students} students
          </span>
          {badge}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {actions}
          <button onClick={onToggleExpand} className="text-navy-400 text-sm">
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-navy-50">
          {/* Summary row */}
          <div className="grid grid-cols-4 px-5 py-3 bg-sky-50 border-b border-navy-50">
            {[
              { label: "Total Hours", value: report.total_hours.toFixed(1) + " hrs" },
              { label: "Sessions",    value: report.total_sessions },
              { label: "Students",    value: report.unique_students },
              { label: "No-shows",    value: report.no_show_count },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-sm font-bold text-navy-700">{value}</p>
                <p className="text-xs text-navy-400">{label}</p>
              </div>
            ))}
          </div>

          {/* Hours by subject — total across every teacher/student, independent of who taught or took it */}
          {report.monthly_report_subject_stats.length > 0 && (
            <>
              <p className="px-5 pt-3 text-xs font-semibold text-navy-400 uppercase tracking-wide">Hours by Subject</p>
              <div className="divide-y divide-navy-50">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-5 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide">
                  <span>Subject</span>
                  <span className="w-16 text-center">Sessions</span>
                  <span className="w-20 text-right">Hours</span>
                </div>
                {report.monthly_report_subject_stats
                  .slice()
                  .sort((a, b) => b.hours - a.hours)
                  .map((s, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-3 px-5 py-2.5">
                      <span className="text-sm text-navy-700">
                        {subjLabel(s.subject_name, s.subject_level)}{s.curriculum_name ? ` · ${s.curriculum_name}` : ""}
                      </span>
                      <span className="text-sm text-navy-600 w-16 text-center">{s.sessions}</span>
                      <span className="text-sm font-medium text-navy-700 w-20 text-right">{s.hours.toFixed(1)} hrs</span>
                    </div>
                  ))}
              </div>
            </>
          )}

          {/* Teacher breakdown — click a row for its subject/curriculum split */}
          <p className="px-5 pt-3 text-xs font-semibold text-navy-400 uppercase tracking-wide">Teacher Hours</p>
          <div className="divide-y divide-navy-50">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-5 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide">
              <span>Teacher</span>
              <span className="w-16 text-center">Sessions</span>
              <span className="w-20 text-right">Hours</span>
              <span className="w-32 text-right">No-show payout</span>
              <span className="w-4"></span>
            </div>
            {report.monthly_report_teacher_stats
              .sort((a, b) => b.hours - a.hours)
              .map((s, i) => {
                const key = entityKey(s.teacher_id, s.teacher_name);
                const isOpen = expandedTeacher === key;
                const subjectRows = report.monthly_report_teacher_subject_stats.filter((r) => entityKey(r.teacher_id, r.teacher_name) === key);
                return (
                  <div key={i}>
                    <button
                      type="button"
                      onClick={() => setExpandedTeacher(isOpen ? null : key)}
                      disabled={subjectRows.length === 0}
                      className="w-full grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-5 py-2.5 text-left hover:bg-navy-50 disabled:cursor-default"
                    >
                      <span className="text-sm text-navy-700">{s.teacher_name ?? "Unknown"}</span>
                      <span className="text-sm text-navy-600 w-16 text-center">{s.sessions}</span>
                      <span className="text-sm font-medium text-navy-700 w-20 text-right">{s.hours.toFixed(1)} hrs</span>
                      <span className="text-sm text-navy-600 w-32 text-right">
                        {s.no_show_payable_count > 0
                          ? `${s.no_show_payable_count} × = ${s.no_show_payout_amount.toFixed(2)}`
                          : <span className="text-navy-300">—</span>}
                      </span>
                      <span className="text-navy-300 text-xs w-4 text-right">{subjectRows.length > 0 ? (isOpen ? "▲" : "▼") : ""}</span>
                    </button>
                    {isOpen && subjectRows.length > 0 && (
                      <div className="bg-navy-50/40 px-5 py-3">
                        <div className="bg-white rounded-xl border border-navy-50 overflow-hidden">
                          <div className="grid grid-cols-5 px-4 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide bg-navy-50">
                            <span className="col-span-2">Subject</span>
                            <span>Program</span>
                            <span className="text-center">Sessions</span>
                            <span className="text-right">Hours</span>
                          </div>
                          {subjectRows.sort((a, b) => b.hours - a.hours).map((r, ri) => (
                            <div key={ri} className="grid grid-cols-5 px-4 py-2 border-t border-navy-50 text-sm">
                              <span className="col-span-2 font-medium text-navy-700">
                                {subjLabel(r.subject_name, r.subject_level)}{r.curriculum_name ? ` · ${r.curriculum_name}` : ""}
                              </span>
                              <span className="text-navy-600">{r.program_type_name ?? "—"}</span>
                              <span className="text-center text-navy-600">{r.sessions}</span>
                              <span className="text-right font-semibold text-navy-700">{r.hours.toFixed(2)} hrs</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Student breakdown (monthly revenue) — click a row for its subject/curriculum split */}
          <p className="px-5 pt-3 text-xs font-semibold text-navy-400 uppercase tracking-wide">Student Hours (Monthly Revenue)</p>
          <div className="divide-y divide-navy-50">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-5 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide">
              <span>Student</span>
              <span className="w-16 text-center">Sessions</span>
              <span className="w-20 text-right">Hours</span>
              <span className="w-4"></span>
            </div>
            {report.monthly_report_student_stats
              .sort((a, b) => b.hours - a.hours)
              .map((s, i) => {
                const key = entityKey(s.student_id, s.student_name);
                const isOpen = expandedStudent === key;
                const subjectRows = report.monthly_report_student_subject_stats.filter((r) => entityKey(r.student_id, r.student_name) === key);
                return (
                  <div key={i}>
                    <button
                      type="button"
                      onClick={() => setExpandedStudent(isOpen ? null : key)}
                      disabled={subjectRows.length === 0}
                      className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-3 px-5 py-2.5 text-left hover:bg-navy-50 disabled:cursor-default"
                    >
                      <span className="text-sm text-navy-700">{s.student_name ?? "Unknown"}</span>
                      <span className="text-sm text-navy-600 w-16 text-center">{s.sessions}</span>
                      <span className="text-sm font-medium text-navy-700 w-20 text-right">{s.hours.toFixed(1)} hrs</span>
                      <span className="text-navy-300 text-xs w-4 text-right">{subjectRows.length > 0 ? (isOpen ? "▲" : "▼") : ""}</span>
                    </button>
                    {isOpen && subjectRows.length > 0 && (
                      <div className="bg-navy-50/40 px-5 py-3">
                        <div className="bg-white rounded-xl border border-navy-50 overflow-hidden">
                          <div className="grid grid-cols-4 px-4 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide bg-navy-50">
                            <span className="col-span-2">Subject</span>
                            <span className="text-center">Sessions</span>
                            <span className="text-right">Hours</span>
                          </div>
                          {subjectRows.sort((a, b) => b.hours - a.hours).map((r, ri) => (
                            <div key={ri} className="grid grid-cols-4 px-4 py-2 border-t border-navy-50 text-sm">
                              <span className="col-span-2 font-medium text-navy-700">
                                {subjLabel(r.subject_name, r.subject_level)}{r.curriculum_name ? ` · ${r.curriculum_name}` : ""}
                              </span>
                              <span className="text-center text-navy-600">{r.sessions}</span>
                              <span className="text-right font-semibold text-navy-700">{r.hours.toFixed(2)} hrs</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
          <div className="px-5 py-2 text-xs text-navy-400">{footerNote}</div>
        </div>
      )}
    </Card>
  );
}

// ── Reports tab (drafts + locked snapshots) ─────────────────────────────────
function ReportsTab({ years }: { years: number[] }) {
  const now = new Date();
  const { profile } = useAuth();
  const { fetchReports, saveDraftReport, lockDraftReport, deleteDraftReport } = useMonthlyReports();
  const { settings: noShowSettings } = useNoShowSettings();

  const [reports, setReports] = useState<MonthlyReportWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filterYear, setFilterYear] = useState<number | "all">("all");
  const [search, setSearch] = useState("");

  // Generate-draft flow state
  const [genYear, setGenYear] = useState(now.getFullYear());
  const [genMonth, setGenMonth] = useState(now.getMonth() + 1);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);

  // Per-row busy state, e.g. "12:lock" or "12:download-logs"
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ report: MonthlyReportWithStats; type: "lock" | "delete" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await fetchReports();
    setReports(data);
    setLoading(false);
  }, [fetchReports]);

  useEffect(() => { load(); }, [load]);

  async function generateDraftFor(year: number, month: number): Promise<{ error: string | null }> {
    if (!profile) return { error: "You must be signed in." };
    setGenLoading(true);
    setGenError(null);
    const [liveData, subjectBreakdown] = await Promise.all([
      fetchPeriodData(year, month),
      fetchMonthSubjectBreakdown(year, month),
    ]);
    const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

    const { error } = await saveDraftReport({
      year, month, periodStart, periodEnd,
      totalHours:     liveData.totalHours,
      totalSessions:  liveData.totalSessions,
      uniqueStudents: liveData.uniqueStudents,
      noShowCount:    liveData.noShowCount,
      teacherStats:        liveData.teacherStats.map((s) => ({
        teacher_id: s.teacherId, teacher_name: s.teacherName, sessions: s.sessions, hours: s.hours,
        no_show_payable_count: s.noShowPayableCount,
        no_show_payout_amount: s.noShowPayableCount * (noShowSettings?.payout_amount ?? 30),
      })),
      studentStats:        liveData.studentStats.map((s) => ({ student_id: s.studentId, student_name: s.studentName, sessions: s.sessions, hours: s.hours })),
      teacherSubjectStats: subjectBreakdown.teacherRows,
      studentSubjectStats: subjectBreakdown.studentRows,
      subjectStats:        subjectBreakdown.subjectRows,
      generatedByUserId: profile.id,
    });

    setGenLoading(false);
    if (error) { setGenError(error); return { error }; }
    setShowGenerateForm(false);
    await load();
    return { error: null };
  }

  // Locking must never freeze stale numbers. A report's totals are snapshotted
  // when it's generated, and Lock alone doesn't re-pull live data — so if
  // sessions were logged between generating and locking, they'd be missed.
  // This regenerates the draft from the latest session data first, opens the
  // row so the admin sees the refreshed totals, and only then asks them to
  // confirm the lock.
  async function startLockWithRefresh(report: MonthlyReportWithStats) {
    setRowBusy(`${report.id}:lock`);
    setRowError(null);
    const { error } = await generateDraftFor(report.year, report.month);
    setRowBusy(null);
    if (error) { setRowError(error); return; }
    setExpanded((s) => { const n = new Set(s); n.add(report.id); return n; });
    const { data } = await fetchReports();
    setReports(data);
    const refreshed = data.find((r) => r.id === report.id) ?? report;
    setPendingAction({ report: refreshed, type: "lock" });
  }

  async function confirmPendingAction() {
    if (!pendingAction || !profile) return;
    const { report, type } = pendingAction;
    setRowBusy(`${report.id}:${type}`);
    setRowError(null);
    const { error } = type === "lock"
      ? await lockDraftReport({ reportId: report.id, lockedByUserId: profile.id })
      : await deleteDraftReport(report.id);
    setRowBusy(null);
    setPendingAction(null);
    if (error) { setRowError(error); return; }
    load();
  }

  function handleDownloadFullReport(report: MonthlyReportWithStats) {
    const teacherBreakdowns = groupBy(report.monthly_report_teacher_subject_stats, (s) => `${s.teacher_id ?? "none"}|${s.teacher_name ?? ""}`)
      .map(([, rows]) => ({
        teacherName: rows[0].teacher_name ?? "Unknown",
        rows: rows.map((r) => ({ subjectName: r.subject_name ?? "—", subjectLevel: r.subject_level, curriculumName: r.curriculum_name, programTypeName: r.program_type_name, sessions: r.sessions, hours: r.hours })),
      }));
    const studentBreakdowns = groupBy(report.monthly_report_student_subject_stats, (s) => `${s.student_id ?? "none"}|${s.student_name ?? ""}`)
      .map(([, rows]) => ({
        studentName: rows[0].student_name ?? "Unknown",
        rows: rows.map((r) => ({ subjectName: r.subject_name ?? "—", subjectLevel: r.subject_level, curriculumName: r.curriculum_name, sessions: r.sessions, hours: r.hours })),
      }));

    const subjectTotals = report.monthly_report_subject_stats
      .map((s) => ({ subjectName: s.subject_name ?? "—", subjectLevel: s.subject_level, curriculumName: s.curriculum_name, sessions: s.sessions, hours: s.hours }))
      .sort((a, b) => b.hours - a.hours);

    buildFullMonthlyReportPdf({
      year: report.year,
      month: report.month,
      totalHours: report.total_hours,
      totalSessions: report.total_sessions,
      uniqueStudents: report.unique_students,
      noShowCount: report.no_show_count,
      teacherStats: report.monthly_report_teacher_stats.map((s) => ({ teacherName: s.teacher_name ?? "Unknown", sessions: s.sessions, hours: s.hours })),
      studentStats: report.monthly_report_student_stats.map((s) => ({ studentName: s.student_name ?? "Unknown", sessions: s.sessions, hours: s.hours })),
      subjectTotals,
      teacherBreakdowns,
      studentBreakdowns,
      locked: report.status === "locked",
    });
  }

  async function handleDownloadSessionLogs(report: MonthlyReportWithStats) {
    setRowBusy(`${report.id}:logs`);
    const rows = await fetchMonthSessionLogRows(report.year, report.month);
    exportMonthSessionLogsCsv(rows, report.year, report.month);
    setRowBusy(null);
  }

  function handleExportSummaryCsv(report: MonthlyReportWithStats) {
    const rows = [
      [`Report: ${formatMonth(report.year, report.month)}`, ""],
      ["Metric", "Value"],
      ["Total Hours",     report.total_hours.toFixed(1)],
      ["Sessions",        String(report.total_sessions)],
      ["Active Students", String(report.unique_students)],
      ["No-shows",        String(report.no_show_count)],
      ["", ""],
      ["Teacher", "Sessions", "Hours", "Payable no-shows", "No-show payout"],
      ...report.monthly_report_teacher_stats.map((s) => [
        s.teacher_name ?? "Unknown",
        String(s.sessions),
        s.hours.toFixed(1),
        String(s.no_show_payable_count),
        s.no_show_payout_amount.toFixed(2),
      ]),
    ];
    exportCSV(rows, `report-${report.year}-${String(report.month).padStart(2, "0")}.csv`);
  }

  const passesFilters = (r: MonthlyReportWithStats) =>
    (filterYear === "all" || r.year === filterYear) &&
    (!search || formatMonth(r.year, r.month).toLowerCase().includes(search.toLowerCase()));

  const drafts = reports.filter((r) => r.status === "draft").filter(passesFilters);
  const locked = reports.filter((r) => r.status === "locked").filter(passesFilters);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search by month…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 w-44"
          />
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            <option value="all">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <Button onClick={() => { setShowGenerateForm((v) => !v); setGenError(null); }}>
          {showGenerateForm ? "Cancel" : "Generate Report"}
        </Button>
      </div>

      {/* Generate-draft form */}
      {showGenerateForm && (
        <Card className="p-5 border border-sky-100 bg-sky-50">
          <p className="font-semibold text-navy-700 mb-3">Generate a monthly report</p>
          <p className="text-xs text-navy-500 mb-3">
            Takes a snapshot of this month's data and saves it as a draft — nothing is frozen yet. Review it (and
            regenerate if session logs change) for as long as it's a draft, then lock it when it's correct.
          </p>
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <PeriodSelector year={genYear} month={genMonth} years={years} onYear={setGenYear} onMonth={setGenMonth} />
          </div>
          {genError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{genError}</p>}
          <div className="flex gap-2">
            <Button onClick={() => generateDraftFor(genYear, genMonth)} disabled={genLoading}>
              {genLoading ? "Generating…" : `Generate ${formatMonth(genYear, genMonth)}`}
            </Button>
            <Button variant="ghost" onClick={() => setShowGenerateForm(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {rowError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{rowError}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      ) : (
        <>
          {/* Drafts */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide">Drafts</h3>
            {drafts.length === 0 ? (
              <Card className="p-6">
                <p className="text-sm text-navy-400">
                  {reports.filter((r) => r.status === "draft").length === 0
                    ? "No draft reports. Click \"Generate Report\" to create one."
                    : "No drafts match the current filter."}
                </p>
              </Card>
            ) : (
              drafts.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  expanded={expanded.has(report.id)}
                  onToggleExpand={() => setExpanded((s) => { const n = new Set(s); n.has(report.id) ? n.delete(report.id) : n.add(report.id); return n; })}
                  badge={<span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Draft</span>}
                  footerNote={`Generated ${new Date(report.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · still editable — session logs for this month are not yet frozen.`}
                  actions={
                    <>
                      <button onClick={() => handleDownloadFullReport(report)} className="text-xs text-sky-500 hover:text-sky-700">
                        Download Full Report (PDF)
                      </button>
                      <button onClick={() => handleDownloadSessionLogs(report)} disabled={rowBusy === `${report.id}:logs`} className="text-xs text-sky-500 hover:text-sky-700 disabled:opacity-50">
                        {rowBusy === `${report.id}:logs` ? "Preparing…" : "Download Session Logs (CSV)"}
                      </button>
                      <button onClick={() => generateDraftFor(report.year, report.month)} className="text-xs text-navy-500 hover:text-navy-700">
                        Regenerate
                      </button>
                      <button onClick={() => startLockWithRefresh(report)} disabled={rowBusy === `${report.id}:lock`} className="text-xs font-semibold text-green-600 hover:text-green-800 disabled:opacity-50">
                        {rowBusy === `${report.id}:lock` ? "Refreshing…" : "Lock"}
                      </button>
                      <button onClick={() => setPendingAction({ report, type: "delete" })} disabled={rowBusy === `${report.id}:delete`} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
                        {rowBusy === `${report.id}:delete` ? "Discarding…" : "Discard"}
                      </button>
                    </>
                  }
                />
              ))
            )}
          </div>

          {/* Locked reports */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-navy-500 uppercase tracking-wide">Locked Reports</h3>
            {locked.length === 0 ? (
              <Card className="p-6">
                <p className="text-sm text-navy-400">
                  {reports.filter((r) => r.status === "locked").length === 0
                    ? "No reports locked yet."
                    : "No locked reports match the current filter."}
                </p>
              </Card>
            ) : (
              locked.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  expanded={expanded.has(report.id)}
                  onToggleExpand={() => setExpanded((s) => { const n = new Set(s); n.has(report.id) ? n.delete(report.id) : n.add(report.id); return n; })}
                  badge={<span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Locked</span>}
                  footerNote={`Locked ${report.locked_at ? new Date(report.locked_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"} · session logs for this month can no longer be added, edited, or deleted.`}
                  actions={
                    <>
                      <button onClick={() => handleDownloadFullReport(report)} className="text-xs text-sky-500 hover:text-sky-700">
                        Download Full Report (PDF)
                      </button>
                      <button onClick={() => handleDownloadSessionLogs(report)} disabled={rowBusy === `${report.id}:logs`} className="text-xs text-sky-500 hover:text-sky-700 disabled:opacity-50">
                        {rowBusy === `${report.id}:logs` ? "Preparing…" : "Download Session Logs (CSV)"}
                      </button>
                      <button onClick={() => handleExportSummaryCsv(report)} className="text-xs text-sky-500 hover:text-sky-700">
                        Export Summary CSV
                      </button>
                    </>
                  }
                />
              ))
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.type === "lock" ? "Lock this report?" : "Discard this draft?"}
        description={
          pendingAction?.type === "lock"
            ? `This report has just been refreshed with the latest session data — review the updated totals in the expanded row before confirming. Locking ${pendingAction ? formatMonth(pendingAction.report.year, pendingAction.report.month) : ""} freezes it for good: session logs for this month can no longer be added, edited, or deleted, and the report itself can't be changed or removed.`
            : `Discarding the ${pendingAction ? formatMonth(pendingAction.report.year, pendingAction.report.month) : ""} draft can be undone by regenerating it later.`
        }
        confirmLabel={pendingAction?.type === "lock" ? "Lock" : "Discard"}
        isDangerous={pendingAction?.type !== "lock"}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function AdminReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>("monthly-revenue");
  const now = new Date();
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const tabs: { id: ReportTab; label: string }[] = [
    { id: "monthly-revenue", label: "Monthly Revenue" },
    { id: "reports",         label: "Reports" },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Reports"
        description="Track monthly revenue and generate locked monthly reports."
      />

      {/* Sub-tabs */}
      <div className="flex gap-0 border-b border-navy-100 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? "border-sky-500 text-sky-600"
                : "border-transparent text-navy-400 hover:text-navy-600 hover:border-navy-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "monthly-revenue" && <MonthlyRevenueTab years={years} />}
      {activeTab === "reports"         && <ReportsTab years={years} />}
    </AdminLayout>
  );
}
