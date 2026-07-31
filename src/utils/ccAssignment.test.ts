import { describe, it, expect } from "vitest";
import {
  CC_ASSIGNMENT_STATUSES,
  activeCcAssignments,
  ccForStudent,
  isCcAssignmentActive,
  latestCcForStudent,
  loggableStudentIds,
  studentIdsForCc,
} from "./ccAssignment";
import type { CcStudentAssignment } from "../types/database";

// Rows are built in the shape and order useCcAssignments returns them:
// newest `assigned_at` first.
function row(over: Partial<CcStudentAssignment> & { id: number }): CcStudentAssignment {
  return {
    student_id: "STU-1",
    cc_teacher_id: "CC-1",
    status: "active",
    assigned_at: "2026-07-01T00:00:00Z",
    unassigned_at: null,
    status_changed_at: null,
    ...over,
  };
}

describe("CC engagement states", () => {
  it("offers active and completed only — a CC engagement is never 'on pause'", () => {
    expect(CC_ASSIGNMENT_STATUSES).toEqual(["active", "completed"]);
  });
});

describe("isCcAssignmentActive", () => {
  it("treats an open row as active", () => {
    expect(isCcAssignmentActive(row({ id: 1 }))).toBe(true);
  });

  it("treats a closed row as inactive", () => {
    expect(isCcAssignmentActive(row({ id: 1, unassigned_at: "2026-07-20T00:00:00Z" }))).toBe(false);
  });

  it("goes by unassigned_at, not status, when a row's two columns disagree", () => {
    // set_cc_assignment_status writes both together; if anything ever wrote
    // only the status, the row must still count as live, because that's what
    // uq_active_cc_per_student would enforce.
    expect(isCcAssignmentActive(row({ id: 1, status: "completed", unassigned_at: null }))).toBe(true);
  });
});

describe("ccForStudent", () => {
  const assignments = [
    row({ id: 3, student_id: "STU-1", cc_teacher_id: "CC-2" }),
    row({ id: 2, student_id: "STU-1", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-06-01T00:00:00Z" }),
    row({ id: 1, student_id: "STU-2", cc_teacher_id: "CC-1" }),
  ];

  it("returns the counsellor on the student's live engagement", () => {
    expect(ccForStudent(assignments, "STU-1")).toBe("CC-2");
  });

  it("returns null for a student whose only engagement has completed", () => {
    const completedOnly = [
      row({ id: 1, student_id: "STU-9", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-06-01T00:00:00Z" }),
    ];
    expect(ccForStudent(completedOnly, "STU-9")).toBeNull();
  });

  it("returns null for a student who has never had a counsellor", () => {
    expect(ccForStudent(assignments, "STU-404")).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(ccForStudent([], "STU-1")).toBeNull();
  });
});

describe("latestCcForStudent", () => {
  it("credits the counsellor who completed the student, not an earlier one", () => {
    const assignments = [
      row({ id: 2, student_id: "STU-1", cc_teacher_id: "CC-2", status: "completed", unassigned_at: "2026-07-20T00:00:00Z", assigned_at: "2026-05-01T00:00:00Z" }),
      row({ id: 1, student_id: "STU-1", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-04-30T00:00:00Z", assigned_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(latestCcForStudent(assignments, "STU-1")).toBe("CC-2");
  });

  it("still names the counsellor once the engagement is closed", () => {
    const assignments = [
      row({ id: 1, student_id: "STU-1", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-07-20T00:00:00Z" }),
    ];
    expect(latestCcForStudent(assignments, "STU-1")).toBe("CC-1");
  });

  it("returns null for a student with no engagement at all", () => {
    expect(latestCcForStudent([], "STU-1")).toBeNull();
  });
});

describe("studentIdsForCc", () => {
  const assignments = [
    row({ id: 3, student_id: "STU-1", cc_teacher_id: "CC-1" }),
    row({ id: 2, student_id: "STU-2", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-07-20T00:00:00Z" }),
    row({ id: 1, student_id: "STU-3", cc_teacher_id: "CC-2" }),
  ];

  it("keeps a completed student on their counsellor's roster", () => {
    // The whole reason completing closes the row instead of deleting it: the
    // student and their session logs stay visible under that counsellor.
    expect(studentIdsForCc(assignments, "CC-1")).toEqual(new Set(["STU-1", "STU-2"]));
  });

  it("never includes another counsellor's students", () => {
    expect(studentIdsForCc(assignments, "CC-2")).toEqual(new Set(["STU-3"]));
  });

  it("returns an empty set for a counsellor with no assignments", () => {
    expect(studentIdsForCc(assignments, "CC-99")).toEqual(new Set());
  });
});

describe("activeCcAssignments", () => {
  it("drops completed engagements", () => {
    const assignments = [
      row({ id: 2, student_id: "STU-2", unassigned_at: "2026-07-20T00:00:00Z", status: "completed" }),
      row({ id: 1, student_id: "STU-1" }),
    ];
    expect(activeCcAssignments(assignments).map((a) => a.id)).toEqual([1]);
  });
});

describe("loggableStudentIds", () => {
  const pc = [
    { student_id: "STU-1", pc_teacher_id: "T-1" },
    { student_id: "STU-2", pc_teacher_id: "T-2" },
  ];
  const cc = [
    { student_id: "STU-3", cc_teacher_id: "T-1" },
    { student_id: "STU-4", cc_teacher_id: "T-2" },
  ];
  const base = { isAdmin: false, teacherId: "T-1", isCoach: false, isCounsellor: false, activePcAssignments: pc, activeCcAssignments: cc };

  it("leaves an admin unrestricted", () => {
    expect(loggableStudentIds({ ...base, isAdmin: true, isCoach: true })).toBeUndefined();
  });

  it("leaves a plain teacher unrestricted — they must be able to log for anyone", () => {
    expect(loggableStudentIds(base)).toBeUndefined();
  });

  it("restricts a coach to their own assigned students", () => {
    expect(loggableStudentIds({ ...base, isCoach: true })).toEqual(new Set(["STU-1"]));
  });

  it("restricts a counsellor to their own assigned students", () => {
    expect(loggableStudentIds({ ...base, isCounsellor: true })).toEqual(new Set(["STU-3"]));
  });

  it("gives someone flagged as both roles the union of the two rosters", () => {
    expect(loggableStudentIds({ ...base, isCoach: true, isCounsellor: true })).toEqual(
      new Set(["STU-1", "STU-3"])
    );
  });

  it("does not double-count a student assigned to the same person under both roles", () => {
    const shared = [{ student_id: "STU-1", cc_teacher_id: "T-1" }];
    expect(
      loggableStudentIds({ ...base, isCoach: true, isCounsellor: true, activeCcAssignments: shared })
    ).toEqual(new Set(["STU-1"]));
  });

  it("returns an empty set — not 'unrestricted' — for a counsellor with no students yet", () => {
    // The distinction matters: undefined would silently open the search to
    // every student in the system.
    expect(loggableStudentIds({ ...base, isCounsellor: true, activeCcAssignments: [] })).toEqual(new Set());
  });

  it("falls back to unrestricted when the teacher record hasn't loaded yet", () => {
    expect(loggableStudentIds({ ...base, teacherId: null, isCounsellor: true })).toBeUndefined();
  });
});
