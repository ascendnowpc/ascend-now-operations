import type { SessionLog } from "../types/database";
import { isNonBillableNoShow } from "./noShow";

// Pure hour-computation helpers, extracted from useStudentPackages so they can
// be unit-tested in isolation (they hold no React/closure state — they only
// read their arguments). The hook re-exports these unchanged; every existing
// caller keeps the same behavior. See db/docs/HOURS_AND_REVENUE_LOGIC.md.

// Compute how many hours have been used for a student/course_type from session logs.
// No Show 1/2 are excluded; No Show + still deducts (see utils/noShow.ts).
// `programTypeIds` is an optional fallback set of
// program_type_id values that belong to this course type — used to match
// sessions whose course_type_id wasn't backfilled (e.g. logged before the
// course_type_id column existed, or against a subtype program type).
//
// `studentPackageId`, when given, scopes the match to that specific
// package row via session_logs.student_package_id — required once a
// student can have more than one package over time for the same course
// type (a locked package plus a fresh renewal): without it, hours from
// the old, locked generation would keep bleeding into the new one's
// balance. Sessions with no student_package_id (legacy rows predating
// this column) fall back to the course_type_id match.
export function computeHoursUsed(
  sessionLogs: (Pick<SessionLog, "course_type_id" | "session_duration_hrs" | "no_show_type"> & { program_type_id?: number | null; student_package_id?: number | null })[],
  courseTypeId: number,
  programTypeIds?: Set<number>,
  studentPackageId?: number | null
): number {
  return sessionLogs
    .filter((s) => {
      if (isNonBillableNoShow(s.no_show_type)) return false;
      if (studentPackageId != null && s.student_package_id != null) {
        return s.student_package_id === studentPackageId;
      }
      if (s.course_type_id === courseTypeId) return true;
      if (s.course_type_id == null && programTypeIds && s.program_type_id != null) {
        return programTypeIds.has(s.program_type_id);
      }
      return false;
    })
    .reduce((sum, s) => sum + (s.session_duration_hrs ?? 0), 0);
}

// Aggregate hours used per subject (ignoring teacher and program type). No
// Show 1/2 excluded, No Show + still counts toward hours but is tracked
// separately from sessionCount (a no-show never "held" a session) so the
// UI can show it as a deduction rather than as an extra session.
export function computeHoursUsedBySubject(
  sessionLogs: Pick<SessionLog, "session_duration_hrs" | "no_show_type" | "subject_id" | "curriculum_id">[]
): { subjectId: number; curriculumId: number | null; hours: number; sessionCount: number; noShowCount: number }[] {
  const totals = new Map<string, { subjectId: number; curriculumId: number | null; hours: number; sessionCount: number; noShowCount: number }>();
  for (const s of sessionLogs) {
    if (isNonBillableNoShow(s.no_show_type) || s.subject_id == null) continue;
    const key = `${s.subject_id}:${s.curriculum_id ?? ""}`;
    const isNoShow = s.no_show_type != null;
    const existing = totals.get(key);
    const hours = s.session_duration_hrs ?? 0;
    if (existing) {
      existing.hours += hours;
      if (isNoShow) existing.noShowCount += 1; else existing.sessionCount += 1;
    } else {
      totals.set(key, {
        subjectId: s.subject_id,
        curriculumId: s.curriculum_id ?? null,
        hours,
        sessionCount: isNoShow ? 0 : 1,
        noShowCount: isNoShow ? 1 : 0,
      });
    }
  }
  return Array.from(totals.values()).sort((a, b) => b.hours - a.hours);
}

// Aggregate hours used per teacher (ignoring subject). Same No Show +
// vs. sessionCount split as computeHoursUsedBySubject above.
export function computeHoursUsedByTeacher(
  sessionLogs: Pick<SessionLog, "session_duration_hrs" | "no_show_type" | "teacher_id">[]
): { teacherId: string; hours: number; sessionCount: number; noShowCount: number }[] {
  const totals = new Map<string, { teacherId: string; hours: number; sessionCount: number; noShowCount: number }>();
  for (const s of sessionLogs) {
    if (isNonBillableNoShow(s.no_show_type) || s.teacher_id == null) continue;
    const isNoShow = s.no_show_type != null;
    const hours = s.session_duration_hrs ?? 0;
    const existing = totals.get(s.teacher_id);
    if (existing) {
      existing.hours += hours;
      if (isNoShow) existing.noShowCount += 1; else existing.sessionCount += 1;
    } else {
      totals.set(s.teacher_id, { teacherId: s.teacher_id, hours, sessionCount: isNoShow ? 0 : 1, noShowCount: isNoShow ? 1 : 0 });
    }
  }
  return Array.from(totals.values()).sort((a, b) => b.hours - a.hours);
}
