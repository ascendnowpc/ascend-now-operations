import type { CcAssignmentStatus, CcStudentAssignment } from "../types/database";

// The two states a College Counsellor engagement can be in, in the order they
// appear everywhere. Deliberately no "on pause" — that exists for a student's
// own status, not for a counselling engagement.
export const CC_ASSIGNMENT_STATUSES: CcAssignmentStatus[] = ["active", "completed"];

export const CC_ASSIGNMENT_STATUS_LABEL: Record<CcAssignmentStatus, string> = {
  active: "Active",
  completed: "Completed",
};

// A row is live iff it has never been closed. `unassigned_at` — not `status` —
// is the authority: it's what `uq_active_cc_per_student` indexes and what
// `set_cc_assignment_status()` writes alongside the status, so a row whose two
// columns somehow disagree is still correctly excluded from "active" here.
export function isCcAssignmentActive(a: Pick<CcStudentAssignment, "unassigned_at">): boolean {
  return a.unassigned_at === null;
}

export function activeCcAssignments<T extends Pick<CcStudentAssignment, "unassigned_at">>(
  assignments: T[]
): T[] {
  return assignments.filter(isCcAssignmentActive);
}

/**
 * The counsellor a student currently has, or null if none.
 * Only a live row counts — a completed engagement leaves the student free to
 * be assigned to someone else.
 */
export function ccForStudent(
  assignments: Pick<CcStudentAssignment, "student_id" | "cc_teacher_id" | "unassigned_at">[],
  studentId: string
): string | null {
  const active = assignments.find((a) => a.student_id === studentId && isCcAssignmentActive(a));
  return active?.cc_teacher_id ?? null;
}

/**
 * The counsellor on a student's most recent engagement, open or closed — how a
 * completed student still shows up under the CC who saw them through.
 *
 * `assignments` is expected in `assigned_at` descending order (the order
 * `useCcAssignments` fetches in), so the first match is the latest engagement.
 * That matters for a student who changed counsellors before finishing: they
 * belong to the one who actually completed them, not to an earlier one.
 */
export function latestCcForStudent(
  assignments: Pick<CcStudentAssignment, "student_id" | "cc_teacher_id">[],
  studentId: string
): string | null {
  return assignments.find((a) => a.student_id === studentId)?.cc_teacher_id ?? null;
}

/**
 * Every student who belongs on a counsellor's roster — live engagements plus
 * completed ones. Completing closes the row rather than deleting it precisely
 * so the student (and the session logs written for them) stay visible here.
 */
export function studentIdsForCc(
  assignments: Pick<CcStudentAssignment, "student_id" | "cc_teacher_id">[],
  ccTeacherId: string
): Set<string> {
  return new Set(assignments.filter((a) => a.cc_teacher_id === ccTeacherId).map((a) => a.student_id));
}

/**
 * Which students a staff member may log a session against.
 *
 * An admin picks anyone (`undefined` = unrestricted). A PC or a CC is limited
 * to their own *live* assignments, and someone flagged as both gets the union
 * of the two rosters rather than whichever role happened to be checked first.
 * A plain teacher is also unrestricted — they need to search any student to
 * log a session.
 */
export function loggableStudentIds(opts: {
  isAdmin: boolean;
  teacherId: string | null;
  isCoach: boolean;
  isCounsellor: boolean;
  /** Already narrowed to live rows by the caller (`usePcAssignments`). */
  activePcAssignments: { student_id: string; pc_teacher_id: string }[];
  /** Already narrowed to live rows by the caller (`useCcAssignments`). */
  activeCcAssignments: { student_id: string; cc_teacher_id: string }[];
}): Set<string> | undefined {
  const { isAdmin, teacherId, isCoach, isCounsellor, activePcAssignments, activeCcAssignments } = opts;
  if (isAdmin || !teacherId || (!isCoach && !isCounsellor)) return undefined;
  const ids = new Set<string>();
  if (isCoach) {
    for (const a of activePcAssignments) {
      if (a.pc_teacher_id === teacherId) ids.add(a.student_id);
    }
  }
  if (isCounsellor) {
    for (const a of activeCcAssignments) {
      if (a.cc_teacher_id === teacherId) ids.add(a.student_id);
    }
  }
  return ids;
}

/**
 * Whether a student can be given to a counsellor right now.
 *
 * `uq_active_cc_per_student` would reject a second live row anyway; this is
 * the readable, pre-flight version of that rule so the admin page can say
 * whose counsellor the student already is instead of surfacing a constraint
 * error. A *completed* engagement is no obstacle — that's the whole point of
 * closing a row rather than keeping it open.
 */
export function canAssignStudentToCc(
  assignments: Pick<CcStudentAssignment, "student_id" | "cc_teacher_id" | "unassigned_at">[],
  studentId: string
): { ok: true } | { ok: false; reason: "already_assigned"; currentCcTeacherId: string } {
  const current = ccForStudent(assignments, studentId);
  if (current === null) return { ok: true };
  return { ok: false, reason: "already_assigned", currentCcTeacherId: current };
}

/**
 * One counsellor's card on `/admin/cc-assignments`: their live students and,
 * separately, the engagements they've finished. Completed rows are kept and
 * listed rather than dropped — the closed row is what still ties that
 * student's session logs to this counsellor.
 */
export function splitCcRoster<T extends Pick<CcStudentAssignment, "cc_teacher_id" | "unassigned_at">>(
  assignments: T[],
  ccTeacherId: string
): { active: T[]; completed: T[] } {
  const mine = assignments.filter((a) => a.cc_teacher_id === ccTeacherId);
  return {
    active: mine.filter(isCcAssignmentActive),
    completed: mine.filter((a) => !isCcAssignmentActive(a)),
  };
}

/**
 * The stat tiles above the counsellor cards.
 *
 * `withCc` counts *students*, not rows — a student who has been through two
 * counsellors is still one student — and only live engagements count toward
 * it. `completed` counts engagements, since one student finishing twice with
 * two different counsellors really is two finished pieces of work.
 */
export function ccAssignmentSummary(
  assignments: Pick<CcStudentAssignment, "student_id" | "unassigned_at">[],
  totalStudents: number
): { totalStudents: number; withCc: number; withoutCc: number; completed: number } {
  const withCc = new Set(activeCcAssignments(assignments).map((a) => a.student_id)).size;
  return {
    totalStudents,
    withCc,
    // Never negative, even if the caller's student list is somehow narrower
    // than the assignment list it was derived from.
    withoutCc: Math.max(0, totalStudents - withCc),
    completed: assignments.filter((a) => !isCcAssignmentActive(a)).length,
  };
}

/**
 * Whether a counsellor's card survives the search box. Matches on the
 * counsellor's own id/name **or** on any student of theirs — including
 * completed ones, so searching a finished student still finds the counsellor
 * who saw them through. A blank query matches everything.
 */
export function ccCardMatchesQuery(opts: {
  query: string;
  counsellor: { id: string; first_name: string; last_name?: string | null };
  assignments: Pick<CcStudentAssignment, "student_id" | "cc_teacher_id">[];
  /** e.g. `"STU-1 Ada Lovelace"`; null for a student id with no record loaded. */
  studentLabel: (studentId: string) => string | null;
}): boolean {
  const q = opts.query.trim().toLowerCase();
  if (!q) return true;

  const { id, first_name, last_name } = opts.counsellor;
  if (`${id} ${first_name} ${last_name ?? ""}`.toLowerCase().includes(q)) return true;

  return opts.assignments
    .filter((a) => a.cc_teacher_id === id)
    .some((a) => (opts.studentLabel(a.student_id) ?? "").toLowerCase().includes(q));
}
