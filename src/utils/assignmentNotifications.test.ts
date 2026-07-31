import { describe, it, expect } from "vitest";
import {
  notificationsForAssign,
  notificationsForCcStatusChange,
  notificationsForRemoval,
  notificationsForStudentCompletion,
} from "./assignmentNotifications";

describe("notificationsForAssign", () => {
  it("tells the new coach a student has joined their roster", () => {
    expect(
      notificationsForAssign({ role: "pc", newAssignmentId: 10, newTeacherId: "T-1", closed: null })
    ).toEqual([{ role: "pc", event: "assigned", assignmentId: 10 }]);
  });

  it("tells the new counsellor the same way", () => {
    expect(
      notificationsForAssign({ role: "cc", newAssignmentId: 10, newTeacherId: "T-1" })
    ).toEqual([{ role: "cc", event: "assigned", assignmentId: 10 }]);
  });

  it("tells both people on a reassignment — who lost the student and who gained them", () => {
    expect(
      notificationsForAssign({
        role: "cc",
        newAssignmentId: 11,
        newTeacherId: "T-2",
        closed: { assignmentId: 10, teacherId: "T-1" },
      })
    ).toEqual([
      { role: "cc", event: "ended", assignmentId: 10 },
      { role: "cc", event: "assigned", assignmentId: 11 },
    ]);
  });

  it("emails the departing person first, so 'you lost a student' never arrives after 'you gained one'", () => {
    const out = notificationsForAssign({
      role: "pc",
      newAssignmentId: 11,
      newTeacherId: "T-2",
      closed: { assignmentId: 10, teacherId: "T-1" },
    });
    expect(out[0].event).toBe("ended");
    expect(out[1].event).toBe("assigned");
  });

  it("does not send a lost-then-gained pair to the same person", () => {
    // Re-assigning a student to whoever already has them closes and re-opens a
    // row. Without this the coach would get told they lost a student and
    // immediately that they gained the same one back.
    expect(
      notificationsForAssign({
        role: "pc",
        newAssignmentId: 11,
        newTeacherId: "T-1",
        closed: { assignmentId: 10, teacherId: "T-1" },
      })
    ).toEqual([{ role: "pc", event: "assigned", assignmentId: 11 }]);
  });

  it("carries the role through untouched, so a PC change never emails about a CC roster", () => {
    const out = notificationsForAssign({
      role: "pc",
      newAssignmentId: 11,
      newTeacherId: "T-2",
      closed: { assignmentId: 10, teacherId: "T-1" },
    });
    expect(out.every((n) => n.role === "pc")).toBe(true);
  });
});

describe("notificationsForCcStatusChange", () => {
  it("treats completing an engagement as the student leaving the roster", () => {
    expect(notificationsForCcStatusChange(7, "completed")).toEqual([
      { role: "cc", event: "ended", assignmentId: 7 },
    ]);
  });

  it("treats reopening as the student rejoining it", () => {
    expect(notificationsForCcStatusChange(7, "active")).toEqual([
      { role: "cc", event: "assigned", assignmentId: 7 },
    ]);
  });

  it("only ever concerns the CC role — a PC assignment has no status of its own", () => {
    expect(notificationsForCcStatusChange(7, "completed")[0].role).toBe("cc");
  });
});

describe("notificationsForRemoval", () => {
  it("reads a PC unassign as the student leaving that coach's roster", () => {
    expect(notificationsForRemoval("pc", 3)).toEqual([{ role: "pc", event: "ended", assignmentId: 3 }]);
  });

  it("reads a deleted CC assignment the same way", () => {
    expect(notificationsForRemoval("cc", 3)).toEqual([{ role: "cc", event: "ended", assignmentId: 3 }]);
  });

  it("always produces exactly one notification — nobody else is affected", () => {
    expect(notificationsForRemoval("cc", 3)).toHaveLength(1);
  });
});

describe("notificationsForStudentCompletion", () => {
  it("tells both the coach and the counsellor when a student is completed", () => {
    // set_student_status closes both live assignments in one call, so both
    // people lose the student from their roster at the same moment.
    expect(notificationsForStudentCompletion({ pcAssignmentId: 4, ccAssignmentId: 9 })).toEqual([
      { role: "pc", event: "ended", assignmentId: 4 },
      { role: "cc", event: "ended", assignmentId: 9 },
    ]);
  });

  it("tells only the coach when the student never had a counsellor", () => {
    expect(notificationsForStudentCompletion({ pcAssignmentId: 4, ccAssignmentId: null })).toEqual([
      { role: "pc", event: "ended", assignmentId: 4 },
    ]);
  });

  it("tells only the counsellor when the student has no live coach", () => {
    expect(notificationsForStudentCompletion({ pcAssignmentId: null, ccAssignmentId: 9 })).toEqual([
      { role: "cc", event: "ended", assignmentId: 9 },
    ]);
  });

  it("sends nothing for a student with no live assignment at all", () => {
    // e.g. completing someone already unassigned — nobody lost anything.
    expect(notificationsForStudentCompletion({ pcAssignmentId: null, ccAssignmentId: null })).toEqual([]);
  });

  it("treats assignment id 0 as a real id, not as absent", () => {
    expect(notificationsForStudentCompletion({ pcAssignmentId: 0, ccAssignmentId: null })).toEqual([
      { role: "pc", event: "ended", assignmentId: 0 },
    ]);
  });
});
