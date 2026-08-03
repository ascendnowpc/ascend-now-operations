import { describe, it, expect } from "vitest";
import {
  coordinatorLogLabel,
  hasCoordinatorPanel,
  isPlainTeacher,
  loginRoleForStaff,
  myStudentsPath,
  staffRecordPath,
  staffRoleFlags,
  staffRoleLabel,
} from "./staffRole";
import type { Teacher } from "../types/database";

function teacher(over: Partial<Teacher> = {}): Pick<Teacher, "is_performance_coach" | "is_college_counselor"> {
  return { is_performance_coach: false, is_college_counselor: false, ...over };
}

describe("staffRoleFlags", () => {
  it("reads both roles off the teachers flags", () => {
    expect(staffRoleFlags("teacher", teacher({ is_performance_coach: true }))).toEqual({
      isCoach: true,
      isCounsellor: false,
    });
    expect(staffRoleFlags("teacher", teacher({ is_college_counselor: true }))).toEqual({
      isCoach: false,
      isCounsellor: true,
    });
  });

  it("recognises someone who is both, which users.role alone cannot express", () => {
    // The whole reason the flags win: a PC-and-CC logs in as a PC, so reading
    // users.role would silently strip their counsellor access.
    expect(
      staffRoleFlags("performance_coach", teacher({ is_performance_coach: true, is_college_counselor: true }))
    ).toEqual({ isCoach: true, isCounsellor: true });
  });

  it("falls back to the login role before the teacher record has loaded", () => {
    expect(staffRoleFlags("college_counselor", null)).toEqual({ isCoach: false, isCounsellor: true });
    expect(staffRoleFlags("performance_coach", undefined)).toEqual({ isCoach: true, isCounsellor: false });
  });

  it("treats a plain teacher as neither", () => {
    expect(staffRoleFlags("teacher", teacher())).toEqual({ isCoach: false, isCounsellor: false });
    expect(staffRoleFlags(null, null)).toEqual({ isCoach: false, isCounsellor: false });
  });

  it("keeps a flag that the login role doesn't mention", () => {
    // A counsellor whose login role says 'teacher' still gets CC access,
    // matching what is_college_counselor() grants server-side.
    expect(staffRoleFlags("teacher", teacher({ is_college_counselor: true })).isCounsellor).toBe(true);
  });
});

describe("staffRoleLabel", () => {
  it("labels a coach, a counsellor, and a plain teacher", () => {
    expect(staffRoleLabel({ isCoach: true, isCounsellor: false })).toBe("Performance Coach");
    expect(staffRoleLabel({ isCoach: false, isCounsellor: true })).toBe("College Counsellor");
    expect(staffRoleLabel({ isCoach: false, isCounsellor: false })).toBe("Teacher");
  });

  it("shows Performance Coach for someone who is both — the richer panel wins", () => {
    expect(staffRoleLabel({ isCoach: true, isCounsellor: true })).toBe("Performance Coach");
  });
});

describe("loginRoleForStaff", () => {
  it("gives a new counsellor the college_counselor login role", () => {
    expect(loginRoleForStaff({ is_performance_coach: false, is_college_counselor: true })).toBe(
      "college_counselor"
    );
  });

  it("gives a new coach the performance_coach login role", () => {
    expect(loginRoleForStaff({ is_performance_coach: true, is_college_counselor: false })).toBe(
      "performance_coach"
    );
  });

  it("gives someone flagged as both the coach role, since users.role holds only one", () => {
    expect(loginRoleForStaff({ is_performance_coach: true, is_college_counselor: true })).toBe(
      "performance_coach"
    );
  });

  it("defaults to plain teacher when neither flag is set", () => {
    expect(loginRoleForStaff({ is_performance_coach: false, is_college_counselor: false })).toBe("teacher");
  });
});

describe("staffRecordPath", () => {
  it("sends a coach to their own detail page", () => {
    expect(staffRecordPath("RANW26-3", { isCoach: true, isCounsellor: false })).toBe("/admin/pcs/RANW26-3");
  });

  it("sends a counsellor to the CC list, since a CC has no detail page", () => {
    expect(staffRecordPath("ANUX26-7", { isCoach: false, isCounsellor: true })).toBe("/admin/ccs/ANUX26-7");
  });

  it("sends a plain teacher to their teacher record", () => {
    expect(staffRecordPath("BHAX26-8", { isCoach: false, isCounsellor: false })).toBe(
      "/admin/teachers/BHAX26-8"
    );
  });

  it("prefers the coach detail page for someone who is both", () => {
    expect(staffRecordPath("RANW26-3", { isCoach: true, isCounsellor: true })).toBe("/admin/pcs/RANW26-3");
  });
});

describe("isPlainTeacher", () => {
  it("keeps a teacher with neither flag on the Teachers list", () => {
    expect(isPlainTeacher(teacher())).toBe(true);
  });

  it("filters a coach out of the Teachers list — they belong on /admin/pcs", () => {
    expect(isPlainTeacher(teacher({ is_performance_coach: true }))).toBe(false);
  });

  it("filters a counsellor out of the Teachers list — they belong on /admin/ccs", () => {
    expect(isPlainTeacher(teacher({ is_college_counselor: true }))).toBe(false);
  });

  it("filters out someone who is both", () => {
    expect(isPlainTeacher(teacher({ is_performance_coach: true, is_college_counselor: true }))).toBe(false);
  });
});

describe("hasCoordinatorPanel", () => {
  it("gives a performance coach the sectioned panel", () => {
    expect(hasCoordinatorPanel({ isCoach: true, isCounsellor: false })).toBe(true);
  });

  it("gives a college counsellor the same panel — a CC sees everything a PC can", () => {
    expect(hasCoordinatorPanel({ isCoach: false, isCounsellor: true })).toBe(true);
  });

  it("gives someone who is both the panel", () => {
    expect(hasCoordinatorPanel({ isCoach: true, isCounsellor: true })).toBe(true);
  });

  it("leaves a plain teacher on the flat nav", () => {
    expect(hasCoordinatorPanel({ isCoach: false, isCounsellor: false })).toBe(false);
  });
});

describe("myStudentsPath", () => {
  it("sends a coach to the PC roster", () => {
    expect(myStudentsPath({ isCoach: true, isCounsellor: false })).toBe("/teacher/students");
  });

  it("sends a counsellor to the CC roster — the two are different tables", () => {
    expect(myStudentsPath({ isCoach: false, isCounsellor: true })).toBe("/teacher/cc-students");
  });

  it("sends someone who is both to the PC roster (the CC one gets its own entry)", () => {
    expect(myStudentsPath({ isCoach: true, isCounsellor: true })).toBe("/teacher/students");
  });
});

describe("coordinatorLogLabel", () => {
  it("names the log after the coach", () => {
    expect(coordinatorLogLabel({ isCoach: true, isCounsellor: false })).toBe("Performance Coach Log");
  });

  it("names the same log after the counsellor when that's the hat they wear", () => {
    expect(coordinatorLogLabel({ isCoach: false, isCounsellor: true })).toBe("College Counsellor Log");
  });
});
