import { describe, it, expect } from "vitest";
import { myRosterStudentIds } from "./staffRoster";

const ME = "RANW26-3";
const OTHER = "MICS26-4";

function pc(student_id: string, pc_teacher_id: string, unassigned_at: string | null = null) {
  return { student_id, pc_teacher_id, unassigned_at };
}
function cc(student_id: string, cc_teacher_id: string, unassigned_at: string | null = null) {
  return { student_id, cc_teacher_id, unassigned_at };
}
function student(id: string, status = "active") {
  return { id, status };
}

function roster(over: Partial<Parameters<typeof myRosterStudentIds>[0]> = {}) {
  return myRosterStudentIds({
    teacherId: ME,
    isCoach: true,
    isCounsellor: false,
    pcAssignments: [],
    ccAssignments: [],
    students: [],
    ...over,
  });
}

describe("myRosterStudentIds", () => {
  it("gives a coach their live PC assignments", () => {
    const r = roster({ pcAssignments: [pc("S1", ME), pc("S2", OTHER)], students: [student("S1"), student("S2")] });
    expect([...r.active]).toEqual(["S1"]);
  });

  it("gives a counsellor their live CC assignments — the same page, a different table", () => {
    const r = roster({
      isCoach: false,
      isCounsellor: true,
      ccAssignments: [cc("S3", ME), cc("S4", OTHER)],
      students: [student("S3"), student("S4")],
    });
    expect([...r.active]).toEqual(["S3"]);
  });

  it("gives someone flagged as both the union of the two rosters, without duplicates", () => {
    const r = roster({
      isCounsellor: true,
      pcAssignments: [pc("S1", ME), pc("S5", ME)],
      ccAssignments: [cc("S1", ME), cc("S6", ME)],
      students: [student("S1"), student("S5"), student("S6")],
    });
    expect([...r.active].sort()).toEqual(["S1", "S5", "S6"]);
  });

  it("ignores a closed assignment when deciding who is live", () => {
    const r = roster({ pcAssignments: [pc("S1", ME, "2026-07-20T00:00:00Z")], students: [student("S1")] });
    expect(r.active.size).toBe(0);
  });

  it("keeps a completed student on the list of whoever saw them through", () => {
    const r = roster({
      pcAssignments: [pc("S1", ME, "2026-07-20T00:00:00Z")],
      students: [student("S1", "completed")],
    });
    expect(r.active.has("S1")).toBe(false);
    expect(r.visible.has("S1")).toBe(true);
  });

  it("keeps a completed student on their counsellor's list too", () => {
    const r = roster({
      isCoach: false,
      isCounsellor: true,
      ccAssignments: [cc("S3", ME, "2026-07-20T00:00:00Z")],
      students: [student("S3", "completed")],
    });
    expect(r.visible.has("S3")).toBe(true);
  });

  it("credits a completed student to their LATEST assignment, not an earlier one", () => {
    // Newest first, as the hooks fetch: the student moved from me to someone
    // else before finishing, so they're not mine any more.
    const r = roster({
      pcAssignments: [pc("S1", OTHER, "2026-07-20T00:00:00Z"), pc("S1", ME, "2026-06-01T00:00:00Z")],
      students: [student("S1", "completed")],
    });
    expect(r.visible.has("S1")).toBe(false);
  });

  it("does not resurrect a student who merely paused — only completed ones carry over", () => {
    const r = roster({
      pcAssignments: [pc("S1", ME, "2026-07-20T00:00:00Z")],
      students: [student("S1", "paused")],
    });
    expect(r.visible.size).toBe(0);
  });

  it("returns nothing before the teacher record has loaded", () => {
    const r = roster({ teacherId: null, pcAssignments: [pc("S1", ME)], students: [student("S1")] });
    expect(r.active.size).toBe(0);
    expect(r.visible.size).toBe(0);
  });

  it("ignores the CC table for someone who isn't a counsellor", () => {
    const r = roster({ ccAssignments: [cc("S3", ME)], students: [student("S3")] });
    expect(r.active.size).toBe(0);
  });
});
