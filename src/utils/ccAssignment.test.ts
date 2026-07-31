import { describe, it, expect } from "vitest";
import {
  CC_ASSIGNMENT_STATUSES,
  activeCcAssignments,
  canAssignStudentToCc,
  ccAssignmentSummary,
  ccCardMatchesQuery,
  ccForStudent,
  isCcAssignmentActive,
  latestCcForStudent,
  loggableStudentIds,
  splitCcRoster,
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

describe("canAssignStudentToCc", () => {
  it("allows a student who has never had a counsellor", () => {
    expect(canAssignStudentToCc([], "STU-1")).toEqual({ ok: true });
  });

  it("allows a student whose previous engagement completed", () => {
    // Completing frees the student up — that's what closing the row is for.
    const assignments = [
      row({ id: 1, student_id: "STU-1", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-07-20T00:00:00Z" }),
    ];
    expect(canAssignStudentToCc(assignments, "STU-1")).toEqual({ ok: true });
  });

  it("refuses a student who already has a live counsellor, and names them", () => {
    // uq_active_cc_per_student would reject this anyway; catching it here is
    // what lets the page say who, instead of surfacing a constraint error.
    const assignments = [row({ id: 1, student_id: "STU-1", cc_teacher_id: "CC-1" })];
    expect(canAssignStudentToCc(assignments, "STU-1")).toEqual({
      ok: false,
      reason: "already_assigned",
      currentCcTeacherId: "CC-1",
    });
  });

  it("ignores another student's live engagement", () => {
    const assignments = [row({ id: 1, student_id: "STU-2", cc_teacher_id: "CC-1" })];
    expect(canAssignStudentToCc(assignments, "STU-1")).toEqual({ ok: true });
  });
});

describe("splitCcRoster", () => {
  const assignments = [
    row({ id: 4, student_id: "STU-1", cc_teacher_id: "CC-1" }),
    row({ id: 3, student_id: "STU-2", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-07-20T00:00:00Z" }),
    row({ id: 2, student_id: "STU-3", cc_teacher_id: "CC-2" }),
    row({ id: 1, student_id: "STU-4", cc_teacher_id: "CC-2", status: "completed", unassigned_at: "2026-06-01T00:00:00Z" }),
  ];

  it("separates a counsellor's live students from their finished ones", () => {
    const { active, completed } = splitCcRoster(assignments, "CC-1");
    expect(active.map((a) => a.id)).toEqual([4]);
    expect(completed.map((a) => a.id)).toEqual([3]);
  });

  it("never leaks another counsellor's rows into either list", () => {
    const { active, completed } = splitCcRoster(assignments, "CC-1");
    expect([...active, ...completed].every((a) => a.cc_teacher_id === "CC-1")).toBe(true);
  });

  it("gives two empty lists for a counsellor with nobody assigned", () => {
    expect(splitCcRoster(assignments, "CC-99")).toEqual({ active: [], completed: [] });
  });

  it("preserves the incoming order within each list", () => {
    // The hook fetches assigned_at desc; the card shows newest first.
    const same = [
      row({ id: 3, student_id: "STU-1", cc_teacher_id: "CC-1" }),
      row({ id: 2, student_id: "STU-2", cc_teacher_id: "CC-1" }),
      row({ id: 1, student_id: "STU-3", cc_teacher_id: "CC-1" }),
    ];
    expect(splitCcRoster(same, "CC-1").active.map((a) => a.id)).toEqual([3, 2, 1]);
  });
});

describe("ccAssignmentSummary", () => {
  it("counts students with a live counsellor, not assignment rows", () => {
    // STU-1 has been through two counsellors — still one student with a CC.
    const assignments = [
      row({ id: 3, student_id: "STU-1", cc_teacher_id: "CC-2" }),
      row({ id: 2, student_id: "STU-1", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-06-01T00:00:00Z" }),
      row({ id: 1, student_id: "STU-2", cc_teacher_id: "CC-1" }),
    ];
    expect(ccAssignmentSummary(assignments, 10)).toEqual({
      totalStudents: 10,
      withCc: 2,
      withoutCc: 8,
      completed: 1,
    });
  });

  it("does not count a completed student as having a CC", () => {
    const assignments = [
      row({ id: 1, student_id: "STU-1", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-07-20T00:00:00Z" }),
    ];
    expect(ccAssignmentSummary(assignments, 4)).toMatchObject({ withCc: 0, withoutCc: 4, completed: 1 });
  });

  it("counts two finished engagements for one student as two completions", () => {
    // Two counsellors each finished a real piece of work for this student.
    const assignments = [
      row({ id: 2, student_id: "STU-1", cc_teacher_id: "CC-2", status: "completed", unassigned_at: "2026-07-20T00:00:00Z" }),
      row({ id: 1, student_id: "STU-1", cc_teacher_id: "CC-1", status: "completed", unassigned_at: "2026-04-30T00:00:00Z" }),
    ];
    expect(ccAssignmentSummary(assignments, 1)).toMatchObject({ withCc: 0, completed: 2 });
  });

  it("reports zeroes when nothing has been assigned yet", () => {
    expect(ccAssignmentSummary([], 0)).toEqual({ totalStudents: 0, withCc: 0, withoutCc: 0, completed: 0 });
  });

  it("never reports a negative 'without a CC' count", () => {
    const assignments = [
      row({ id: 2, student_id: "STU-1", cc_teacher_id: "CC-1" }),
      row({ id: 1, student_id: "STU-2", cc_teacher_id: "CC-1" }),
    ];
    expect(ccAssignmentSummary(assignments, 1).withoutCc).toBe(0);
  });
});

describe("ccCardMatchesQuery", () => {
  const counsellor = { id: "CCT-7", first_name: "Ada", last_name: "Lovelace" };
  const assignments = [
    row({ id: 2, student_id: "STU-1", cc_teacher_id: "CCT-7" }),
    row({ id: 1, student_id: "STU-2", cc_teacher_id: "CCT-7", status: "completed", unassigned_at: "2026-07-20T00:00:00Z" }),
  ];
  const labels: Record<string, string> = {
    "STU-1": "STU-1 Grace Hopper",
    "STU-2": "STU-2 Alan Turing",
  };
  const studentLabel = (id: string) => labels[id] ?? null;
  const match = (query: string) => ccCardMatchesQuery({ query, counsellor, assignments, studentLabel });

  it("shows every card when the search box is empty", () => {
    expect(match("")).toBe(true);
    expect(match("   ")).toBe(true);
  });

  it("matches the counsellor's own name, case-insensitively", () => {
    expect(match("lovelace")).toBe(true);
    expect(match("ADA")).toBe(true);
  });

  it("matches the counsellor's id", () => {
    expect(match("CCT-7")).toBe(true);
  });

  it("matches on one of their students by name or id", () => {
    expect(match("grace")).toBe(true);
    expect(match("STU-1")).toBe(true);
  });

  it("still finds the counsellor by a student they already completed", () => {
    // The point of keeping the closed row: the finished student stays findable
    // under the counsellor who saw them through.
    expect(match("turing")).toBe(true);
  });

  it("does not match an unrelated term", () => {
    expect(match("babbage")).toBe(false);
  });

  it("does not match another counsellor's student", () => {
    const other = [row({ id: 1, student_id: "STU-1", cc_teacher_id: "CCT-8" })];
    expect(ccCardMatchesQuery({ query: "grace", counsellor, assignments: other, studentLabel })).toBe(false);
  });

  it("tolerates a student whose record hasn't loaded", () => {
    expect(
      ccCardMatchesQuery({ query: "grace", counsellor, assignments, studentLabel: () => null })
    ).toBe(false);
  });
});
