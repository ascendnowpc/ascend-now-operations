/**
 * The "Performance Coach" field on a session log.
 *
 * For any session that involves a student, the coach is **not a choice** — it
 * is whoever that student is currently assigned to. Offering a dropdown there
 * let a session be filed against a coach who has nothing to do with the
 * student, which is exactly what happened when someone picked a coordinator
 * before picking the student.
 *
 * The one case that still needs a picker is the program types with no student
 * at all (Work for Ascend Now, and Ascend Offline Work, which reuses the same
 * field as "Assigned by") — there's no assignment to derive anything from.
 */

export type CoordinatorField =
  /** Derived from the student; rendered read-only. */
  | { mode: "derived"; teacherId: string | null; hint: string | null }
  /** No student involved in this program type — pick from the coach list. */
  | { mode: "picker" };

export function coordinatorFieldState(opts: {
  studentInvolved: boolean;
  selectedStudentId: string | null;
  /** The student's currently-assigned PC, or null. */
  assignedPcId: string | null;
}): CoordinatorField {
  if (!opts.studentInvolved) return { mode: "picker" };

  if (opts.selectedStudentId === null) {
    return {
      mode: "derived",
      teacherId: null,
      hint: "Select a student first.",
    };
  }

  if (opts.assignedPcId === null) {
    // Every student is meant to have a coach, so this is a data problem an
    // admin has to fix — say so rather than silently offering every coach.
    return {
      mode: "derived",
      teacherId: null,
      hint: "This student has no Performance Coach assigned. Ask an admin to assign one.",
    };
  }

  return { mode: "derived", teacherId: opts.assignedPcId, hint: null };
}

/**
 * What `coordinator_teacher_id` should hold for the current selection.
 *
 * Returns "" (meaning: store NULL) whenever there's no student or no coach to
 * derive from, so a stale id from a previous student can never survive.
 */
export function derivedCoordinatorId(opts: {
  studentInvolved: boolean;
  assignedPcId: string | null;
}): string {
  if (!opts.studentInvolved) return "";
  return opts.assignedPcId ?? "";
}
