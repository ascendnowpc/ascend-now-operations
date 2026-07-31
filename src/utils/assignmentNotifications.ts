/**
 * Who to email when a student's Performance Coach or College Counsellor
 * assignment changes.
 *
 * The recipient is always the *staff member*, never the student: assignment is
 * an admin-only action, so without this the coach or counsellor would only
 * find out a student had landed on (or left) their roster by noticing it on
 * their My Students page.
 *
 * These functions decide only *which* notifications a change implies; sending
 * is `notify-assignment-change`. Keeping the decision here is what makes it
 * testable — see assignmentNotifications.test.ts.
 */

export type AssignmentRole = "pc" | "cc";

/** `assigned` = a student joined this person's roster; `ended` = they left it. */
export type AssignmentEvent = "assigned" | "ended";

export interface AssignmentNotification {
  role: AssignmentRole;
  event: AssignmentEvent;
  assignmentId: number;
}

/**
 * Assigning a student to a coach/counsellor.
 *
 * Re-assignment is two events, not one: the previous holder is told they lost
 * the student and the new one is told they gained them. The exception is
 * re-assigning a student to the person who already has them — a no-op the
 * admin pages allow (it closes and re-opens a row), which must not produce a
 * "you lost a student" / "you gained a student" pair for the same person.
 */
export function notificationsForAssign(opts: {
  role: AssignmentRole;
  newAssignmentId: number;
  newTeacherId: string;
  /** The engagement closed to make room, if any. */
  closed?: { assignmentId: number; teacherId: string } | null;
}): AssignmentNotification[] {
  const { role, newAssignmentId, newTeacherId, closed } = opts;
  const out: AssignmentNotification[] = [];
  if (closed && closed.teacherId !== newTeacherId) {
    out.push({ role, event: "ended", assignmentId: closed.assignmentId });
  }
  out.push({ role, event: "assigned", assignmentId: newAssignmentId });
  return out;
}

/**
 * A CC engagement's status changing. Completing ends it; re-opening puts the
 * student back on that counsellor's live roster, which is an `assigned` from
 * their point of view.
 */
export function notificationsForCcStatusChange(
  assignmentId: number,
  status: "active" | "completed"
): AssignmentNotification[] {
  return [{ role: "cc", event: status === "completed" ? "ended" : "assigned", assignmentId }];
}

/**
 * Unassigning (PC) or deleting an assignment made in error (CC). Both mean the
 * student is off that person's live roster, so both read as `ended`.
 *
 * For a delete the row is about to disappear, so the notification has to be
 * fired *before* the delete — the edge function resolves the student and
 * teacher from the row itself.
 */
export function notificationsForRemoval(
  role: AssignmentRole,
  assignmentId: number
): AssignmentNotification[] {
  return [{ role, event: "ended", assignmentId }];
}

/**
 * Completing a *student* — `set_student_status(..., 'completed')` closes their
 * live PC and CC assignments in the same call — so both people lose them from
 * their roster and both need telling.
 *
 * The ids have to be read *before* the RPC runs, while the rows are still
 * open; afterwards there's no way to tell an engagement that just ended from
 * one that ended months ago.
 */
export function notificationsForStudentCompletion(opts: {
  pcAssignmentId: number | null;
  ccAssignmentId: number | null;
}): AssignmentNotification[] {
  const out: AssignmentNotification[] = [];
  if (opts.pcAssignmentId !== null) {
    out.push({ role: "pc", event: "ended", assignmentId: opts.pcAssignmentId });
  }
  if (opts.ccAssignmentId !== null) {
    out.push({ role: "cc", event: "ended", assignmentId: opts.ccAssignmentId });
  }
  return out;
}
