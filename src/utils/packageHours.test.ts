import { describe, it, expect } from "vitest";
import { computeHoursUsed, computeHoursUsedBySubject, computeHoursUsedByTeacher } from "./packageHours";

// Minimal session-log factory — only the fields the hour math reads.
type S = Parameters<typeof computeHoursUsed>[0][number];
const s = (o: Partial<S>): S => ({
  course_type_id: null,
  session_duration_hrs: 1,
  no_show_type: null,
  program_type_id: null,
  student_package_id: null,
  ...o,
});

describe("computeHoursUsed — the billing engine", () => {
  it("sums duration for sessions matching the course type", () => {
    const logs = [
      s({ course_type_id: 1, session_duration_hrs: 1 }),
      s({ course_type_id: 1, session_duration_hrs: 0.5 }),
      s({ course_type_id: 2, session_duration_hrs: 2 }), // different course type
    ];
    expect(computeHoursUsed(logs, 1)).toBe(1.5);
  });

  it("excludes No Show 1 and No Show 2 (non-billable), counts No Show + ", () => {
    const logs = [
      s({ course_type_id: 1, session_duration_hrs: 1, no_show_type: "no_show_1" }),
      s({ course_type_id: 1, session_duration_hrs: 1, no_show_type: "no_show_2" }),
      s({ course_type_id: 1, session_duration_hrs: 1, no_show_type: "no_show_plus" }),
      s({ course_type_id: 1, session_duration_hrs: 1, no_show_type: null }),
    ];
    // Only No Show + (1) and the real session (1) count.
    expect(computeHoursUsed(logs, 1)).toBe(2);
  });

  it("treats a null duration as zero rather than NaN", () => {
    const logs = [s({ course_type_id: 1, session_duration_hrs: null })];
    expect(computeHoursUsed(logs, 1)).toBe(0);
  });

  describe("studentPackageId scoping (prevents a locked package bleeding into a renewal)", () => {
    it("counts only sessions on the specified package when scoped", () => {
      const logs = [
        s({ course_type_id: 1, session_duration_hrs: 2, student_package_id: 10 }), // old/locked
        s({ course_type_id: 1, session_duration_hrs: 3, student_package_id: 11 }), // fresh renewal
      ];
      expect(computeHoursUsed(logs, 1, undefined, 11)).toBe(3);
      expect(computeHoursUsed(logs, 1, undefined, 10)).toBe(2);
    });

    it("WITHOUT scoping, both generations' hours merge (documented reason the param exists)", () => {
      const logs = [
        s({ course_type_id: 1, session_duration_hrs: 2, student_package_id: 10 }),
        s({ course_type_id: 1, session_duration_hrs: 3, student_package_id: 11 }),
      ];
      expect(computeHoursUsed(logs, 1)).toBe(5);
    });

    it("a legacy session with null student_package_id falls back to the course_type match even when scoped", () => {
      const logs = [
        s({ course_type_id: 1, session_duration_hrs: 4, student_package_id: null }), // legacy
        s({ course_type_id: 1, session_duration_hrs: 3, student_package_id: 11 }),
      ];
      // Scoped to package 11, but the legacy null-package row still counts via course_type.
      expect(computeHoursUsed(logs, 1, undefined, 11)).toBe(7);
    });
  });

  describe("programTypeIds fallback (legacy rows missing course_type_id)", () => {
    it("matches by program type only when course_type_id is null", () => {
      const logs = [
        s({ course_type_id: null, program_type_id: 5, session_duration_hrs: 1 }),
        s({ course_type_id: null, program_type_id: 99, session_duration_hrs: 1 }), // not in set
      ];
      expect(computeHoursUsed(logs, 1, new Set([5]))).toBe(1);
    });

    it("does NOT use the program-type fallback when course_type_id is present", () => {
      const logs = [s({ course_type_id: 2, program_type_id: 5, session_duration_hrs: 1 })];
      // course_type_id (2) != target (1); program fallback must not rescue it.
      expect(computeHoursUsed(logs, 1, new Set([5]))).toBe(0);
    });
  });
});

describe("computeHoursUsedBySubject", () => {
  it("splits No Show + into noShowCount, not sessionCount, but still sums hours", () => {
    const logs = [
      { subject_id: 7, curriculum_id: 3, session_duration_hrs: 1, no_show_type: null },
      { subject_id: 7, curriculum_id: 3, session_duration_hrs: 1, no_show_type: "no_show_plus" as const },
    ];
    const [row] = computeHoursUsedBySubject(logs);
    expect(row).toMatchObject({ subjectId: 7, hours: 2, sessionCount: 1, noShowCount: 1 });
  });

  it("excludes non-billable no-shows and null subjects entirely", () => {
    const logs = [
      { subject_id: null, curriculum_id: null, session_duration_hrs: 5, no_show_type: null },
      { subject_id: 7, curriculum_id: null, session_duration_hrs: 5, no_show_type: "no_show_1" as const },
    ];
    expect(computeHoursUsedBySubject(logs)).toEqual([]);
  });

  it("keys distinct curricula for the same subject separately and sorts by hours desc", () => {
    const logs = [
      { subject_id: 7, curriculum_id: 1, session_duration_hrs: 1, no_show_type: null },
      { subject_id: 7, curriculum_id: 2, session_duration_hrs: 3, no_show_type: null },
    ];
    const rows = computeHoursUsedBySubject(logs);
    expect(rows.map((r) => r.hours)).toEqual([3, 1]);
    expect(rows).toHaveLength(2);
  });
});

describe("computeHoursUsedByTeacher", () => {
  it("aggregates per teacher and separates no-show count", () => {
    const logs = [
      { teacher_id: 1, session_duration_hrs: 1, no_show_type: null },
      { teacher_id: 1, session_duration_hrs: 2, no_show_type: "no_show_plus" as const },
      { teacher_id: 2, session_duration_hrs: 4, no_show_type: null },
    ];
    const rows = computeHoursUsedByTeacher(logs);
    expect(rows[0]).toMatchObject({ teacherId: 2, hours: 4, sessionCount: 1, noShowCount: 0 });
    expect(rows[1]).toMatchObject({ teacherId: 1, hours: 3, sessionCount: 1, noShowCount: 1 });
  });
});
