import { describe, it, expect } from "vitest";
import {
  STUDENT_STATUSES,
  STUDENT_STATUS_LABEL,
  studentStatusBadgeClass,
  normalizeStudentStatus,
} from "./studentStatus";

describe("STUDENT_STATUSES — the shared ordering", () => {
  it("offers the three categories in one fixed order everywhere", () => {
    expect(STUDENT_STATUSES).toEqual(["active", "paused", "completed"]);
  });

  it("has a label for every status", () => {
    for (const status of STUDENT_STATUSES) {
      expect(STUDENT_STATUS_LABEL[status]).toBeTruthy();
    }
    expect(STUDENT_STATUS_LABEL.paused).toBe("On pause");
  });
});

describe("studentStatusBadgeClass", () => {
  it("gives each status its own badge styling", () => {
    const classes = STUDENT_STATUSES.map(studentStatusBadgeClass);
    expect(new Set(classes).size).toBe(STUDENT_STATUSES.length);
    expect(studentStatusBadgeClass("active")).toContain("green");
    expect(studentStatusBadgeClass("paused")).toContain("amber");
  });
});

describe("normalizeStudentStatus — legacy/unknown rows read as active", () => {
  it("passes the two non-default statuses through unchanged", () => {
    expect(normalizeStudentStatus("paused")).toBe("paused");
    expect(normalizeStudentStatus("completed")).toBe("completed");
  });

  it("falls back to active for rows written before the column existed", () => {
    expect(normalizeStudentStatus(null)).toBe("active");
    expect(normalizeStudentStatus(undefined)).toBe("active");
    expect(normalizeStudentStatus("")).toBe("active");
  });

  it("falls back to active rather than throwing on an unexpected value", () => {
    expect(normalizeStudentStatus("archived")).toBe("active");
    expect(normalizeStudentStatus("PAUSED")).toBe("active");
  });
});
