import type { Teacher } from "../types/database";

/** A `<SelectInput>` option — teacher ids are text (`"RANW26-3"`). */
export interface TeacherOption {
  value: string;
  label: string;
}

type NamedTeacher = Pick<Teacher, "first_name" | "last_name">;
type SelectableTeacher = Pick<Teacher, "id" | "is_active" | "is_performance_coach"> & NamedTeacher;

/**
 * A staff member's display name.
 *
 * Whitespace is collapsed, not just trimmed: some names carry a trailing
 * space from the admin form (e.g. `first_name` "Sumer "), which a bare
 * template + `.trim()` turns into "Sumer  Broota" with a double space. HTML
 * happens to collapse that when rendered, but the same string is also used
 * for CSV export and matching, where it doesn't.
 */
export function teacherLabel(t: NamedTeacher): string {
  return `${t.first_name ?? ""} ${t.last_name ?? ""}`.replace(/\s+/g, " ").trim();
}

/**
 * Options for a teacher/coach filter dropdown — **active staff only**.
 *
 * Deactivating a teacher is how staff who have left are retired, and every
 * other picker in the app (`SessionLogFormView`'s coach list,
 * `CoordinatorLogsListView`'s, `AdminPcAssignmentsPage`'s,
 * `AdminZoomInvoicesPage`'s) already drops them. The session-log list's two
 * dropdowns were the exception and kept offering them forever.
 *
 * Note the deliberate consequence: a deactivated teacher's existing session
 * logs are still listed, and still show their name in the Teacher column —
 * they simply can't be *filtered to* by name any more. That matches how the
 * rest of the app treats retired staff; reaching their sessions is what the
 * student/date filters are for.
 *
 * `performanceCoachesOnly` narrows to coaches for the Performance Coach
 * filter, which is the same list minus the plain teachers.
 */
export function teacherFilterOptions(
  teachers: SelectableTeacher[],
  opts: { performanceCoachesOnly?: boolean } = {}
): TeacherOption[] {
  return teachers
    .filter((t) => t.is_active)
    .filter((t) => !opts.performanceCoachesOnly || t.is_performance_coach)
    .map((t) => ({ value: String(t.id), label: teacherLabel(t) }));
}
