import type { Teacher, UserRole } from "../types/database";

/**
 * Which extra hats a logged-in staff member wears.
 *
 * `users.role` carries exactly one login role, so a teacher who is both a
 * Performance Coach and a College Counsellor can only be one of them there.
 * The `teachers` flags are therefore the real answer, and the role is only a
 * fallback for the window before the teacher record has loaded. The
 * `is_college_counselor()` SQL helper is keyed the same way for the same
 * reason, so the UI and RLS agree about who is a counsellor.
 */
export function staffRoleFlags(
  profileRole: UserRole | null | undefined,
  teacher: Pick<Teacher, "is_performance_coach" | "is_college_counselor"> | null | undefined
): { isCoach: boolean; isCounsellor: boolean } {
  return {
    isCoach: profileRole === "performance_coach" || teacher?.is_performance_coach === true,
    isCounsellor: profileRole === "college_counselor" || teacher?.is_college_counselor === true,
  };
}

/**
 * The sidebar's role badge, and the name of the coordinator nav section. PC
 * wins when someone holds both — the CC roster still shows up as its own entry
 * inside that section.
 */
export function staffRoleLabel(flags: { isCoach: boolean; isCounsellor: boolean }): string {
  if (flags.isCoach) return "Performance Coach";
  if (flags.isCounsellor) return "College Counsellor";
  return "Teacher";
}

/**
 * Whether this staff member gets the full coordinator panel — the sectioned
 * sidebar with a roster, students' logs, the coordinator log and renewal
 * requests — rather than the flat plain-teacher one.
 *
 * As of 2026-08-03 a College Counsellor sees everything a Performance Coach
 * does (RLS widened to match in `20260808000000_cc_gets_pc_access.sql`), so
 * either hat is enough.
 */
export function hasCoordinatorPanel(flags: { isCoach: boolean; isCounsellor: boolean }): boolean {
  return flags.isCoach || flags.isCounsellor;
}

/**
 * Where "My Students" points in the coordinator panel. The two rosters are
 * different tables with different lifecycles (see `useCcAssignments`), so a
 * coach lands on the PC roster and a counsellor on the CC one. Someone who is
 * both gets the PC roster here and the CC roster as its own entry.
 */
export function myStudentsPath(flags: { isCoach: boolean; isCounsellor: boolean }): string {
  return flags.isCoach ? "/teacher/students" : "/teacher/cc-students";
}

/**
 * The coordinator-log nav label. One `coordinator_logs` table, but the person
 * filling it in should see their own role's name on it.
 */
export function coordinatorLogLabel(flags: { isCoach: boolean; isCounsellor: boolean }): string {
  return `${staffRoleLabel(flags)} Log`;
}

/**
 * The single `users.role` to give a new staff account.
 *
 * Mirrored by the `create-teacher-with-user` edge function, which can't import
 * from `src/` — keep the two in step. PC takes precedence for the same reason
 * it wins the sidebar label, and the CC grants still reach a PC-and-CC because
 * RLS reads the flag, not this role.
 */
export function loginRoleForStaff(flags: {
  is_performance_coach: boolean;
  is_college_counselor: boolean;
}): UserRole {
  if (flags.is_performance_coach) return "performance_coach";
  if (flags.is_college_counselor) return "college_counselor";
  return "teacher";
}

/**
 * Where the admin teacher form lands after a save. Coaches and counsellors
 * each have a detail page of their own; a plain teacher's record is the
 * teacher one.
 */
export function staffRecordPath(
  teacherId: string,
  flags: { isCoach: boolean; isCounsellor: boolean }
): string {
  if (flags.isCoach) return `/admin/pcs/${teacherId}`;
  if (flags.isCounsellor) return `/admin/ccs/${teacherId}`;
  return `/admin/teachers/${teacherId}`;
}

/**
 * Which role a teacher belongs to on the admin side. `/admin/teachers` lists
 * plain teachers only — coaches live on `/admin/pcs`, counsellors on
 * `/admin/ccs` — so a teacher carrying either flag is filtered out of it.
 */
export function isPlainTeacher(
  teacher: Pick<Teacher, "is_performance_coach" | "is_college_counselor">
): boolean {
  return !teacher.is_performance_coach && !teacher.is_college_counselor;
}
