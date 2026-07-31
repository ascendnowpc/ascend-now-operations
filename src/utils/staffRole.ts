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
 * The sidebar's role badge. PC wins when someone holds both, because it's the
 * richer panel — the CC roster still shows up as its own nav group.
 */
export function staffRoleLabel(flags: { isCoach: boolean; isCounsellor: boolean }): string {
  if (flags.isCoach) return "Performance Coach";
  if (flags.isCounsellor) return "College Counsellor";
  return "Teacher";
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
 * Where the admin teacher form lands after a save. A PC has a detail page of
 * its own; a CC does not — their record is the plain teacher one — so a
 * counsellor goes back to the CC list instead.
 */
export function staffRecordPath(
  teacherId: string,
  flags: { isCoach: boolean; isCounsellor: boolean }
): string {
  if (flags.isCoach) return `/admin/pcs/${teacherId}`;
  if (flags.isCounsellor) return "/admin/ccs";
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
