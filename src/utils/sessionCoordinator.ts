/**
 * The "Performance Coach" field on a session log.
 *
 * For any session that involves a student on record, the coach is **not a
 * choice** — it is whoever that student is currently assigned to. Offering a
 * dropdown there let a session be filed against a coach who has nothing to do
 * with the student, which is exactly what happened when someone picked a
 * coordinator before picking the student.
 *
 * Two cases still need a picker, because there is no assignment to read:
 *   - the program types with no student at all (Work for Ascend Now, and
 *     Ascend Offline Work, which reuses the same field as "Assigned by");
 *   - a **demo lesson for someone who isn't in the database yet** — the form
 *     lets it be logged against a typed-in name instead of a student record
 *     (a prospective student), and that name has no coach to derive from.
 */

export type CoordinatorField =
  /** Derived from the student; rendered read-only. */
  | { mode: "derived"; teacherId: string | null; hint: string | null }
  /** Nothing to derive from — pick from the coach list. */
  | { mode: "picker" };

export interface CoordinatorOpts {
  studentInvolved: boolean;
  selectedStudentId: string | null;
  /** The student's currently-assigned PC, or null. */
  assignedPcId: string | null;
  /**
   * True when this session may name a student who has no record at all — a
   * demo lesson logged against a typed-in name. Then "no student selected"
   * is a legitimate final state, not a step on the way to selecting one.
   */
  studentRecordOptional?: boolean;
}

export function coordinatorFieldState(opts: CoordinatorOpts): CoordinatorField {
  if (!opts.studentInvolved) return { mode: "picker" };

  if (opts.selectedStudentId === null) {
    // A demo lesson for a prospective student: there is no record, so no
    // assignment — the coach has to be chosen from the full list.
    if (opts.studentRecordOptional) return { mode: "picker" };
    return {
      mode: "derived",
      teacherId: null,
      hint: "Select a student first.",
    };
  }

  if (opts.assignedPcId === null) {
    // A student on record is meant to have a coach, so this is a data problem
    // an admin has to fix — say so rather than silently offering every coach.
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
 * - A string (possibly "") is authoritative: the field is derived, so the form
 *   must hold exactly this. "" means store NULL, and is what stops a previous
 *   student's coach from surviving a switch.
 * - `null` means **leave the current value alone** — the field is a picker and
 *   the value belongs to whoever is filling the form.
 */
export function derivedCoordinatorId(opts: CoordinatorOpts): string | null {
  if (coordinatorFieldState(opts).mode === "picker") return null;
  if (!opts.studentInvolved) return "";
  return opts.assignedPcId ?? "";
}
