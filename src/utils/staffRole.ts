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
 * The sidebar's role badge — the one thing in the coordinator panel that still
 * names the person's own role. PC wins when someone holds both.
 */
export function staffRoleLabel(flags: { isCoach: boolean; isCounsellor: boolean }): string {
  if (flags.isCoach) return "Performance Coach";
  if (flags.isCounsellor) return "College Counsellor";
  return "Teacher";
}

/**
 * Whether this staff member gets the full coordinator panel — the sectioned
 * sidebar with My Students, Students' Logs, the log and renewal requests —
 * rather than the flat plain-teacher one.
 *
 * As of 2026-08-03 a College Counsellor sees everything a Performance Coach
 * does (RLS widened to match in `20260808000000_cc_gets_pc_access.sql`), so
 * either hat is enough — and the panel itself is identical for both. There is
 * no counsellor-specific tab, roster page or log.
 */
export function hasCoordinatorPanel(flags: { isCoach: boolean; isCounsellor: boolean }): boolean {
  return flags.isCoach || flags.isCounsellor;
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
