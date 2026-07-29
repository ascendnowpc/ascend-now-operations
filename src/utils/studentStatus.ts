import type { StudentStatus } from "../types/database";

// The three student categories, in the order they're offered everywhere
// (tabs, dropdowns, menus) so the sequence never differs between views.
export const STUDENT_STATUSES: StudentStatus[] = ["active", "paused", "completed"];

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  active: "Active",
  paused: "On pause",
  completed: "Completed",
};

const STUDENT_STATUS_BADGE: Record<StudentStatus, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  paused: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-navy-50 text-navy-500 border-navy-100",
};

export function studentStatusBadgeClass(status: StudentStatus): string {
  return STUDENT_STATUS_BADGE[status] ?? STUDENT_STATUS_BADGE.active;
}

// Rows written before the status column existed, or any value that somehow
// escapes the CHECK constraint, read as "active" rather than blowing up a list.
export function normalizeStudentStatus(status: string | null | undefined): StudentStatus {
  return status === "paused" || status === "completed" ? status : "active";
}
