import { describe, it, expect } from "vitest";
import {
  membersByPackage,
  packageStudentIds,
  isSharedPackage,
  packagesForStudent,
  householdPackages,
  totalPackageHours,
} from "./householdPackages";
import type { StudentPackage } from "../types/database";

function pkg(over: Partial<StudentPackage> = {}): StudentPackage {
  return {
    id: 1,
    student_id: null,
    parent_id: null,
    program_type_id: null,
    course_type_id: 1,
    package_type_id: null,
    pool_label: null,
    total_hours_purchased: 50,
    hours_used: 0,
    status: "active",
    closed_at: null,
    is_locked: false,
    locked_at: null,
    locked_by_user_id: null,
    locked_hours_used: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

// A two-child household: an individual pool each, and one shared between them.
const OWN_A = pkg({ id: 1, student_id: "A" });
const OWN_B = pkg({ id: 2, student_id: "B" });
const SHARED = pkg({ id: 3, parent_id: "P" });
const OUTSIDER = pkg({ id: 4, student_id: "Z" });
const ALL = [OWN_A, OWN_B, SHARED, OUTSIDER];
const MEMBERS = membersByPackage([
  { student_package_id: 3, student_id: "A" },
  { student_package_id: 3, student_id: "B" },
]);

describe("membersByPackage", () => {
  it("groups member rows by the package they belong to", () => {
    expect(MEMBERS.get(3)).toEqual(["A", "B"]);
  });

  it("has no entry for a package nobody was named on", () => {
    expect(MEMBERS.get(1)).toBeUndefined();
  });
});

describe("packageStudentIds", () => {
  it("is the one student on an individual package", () => {
    expect(packageStudentIds(OWN_A, MEMBERS)).toEqual(["A"]);
  });

  it("is both named children on a shared package", () => {
    expect(packageStudentIds(SHARED, MEMBERS)).toEqual(["A", "B"]);
  });

  it("is empty for a shared package whose members haven't loaded", () => {
    expect(packageStudentIds(SHARED, new Map())).toEqual([]);
  });
});

describe("isSharedPackage", () => {
  it("is shared when a parent owns it", () => {
    expect(isSharedPackage(SHARED)).toBe(true);
  });

  it("is not shared when a student owns it", () => {
    expect(isSharedPackage(OWN_A)).toBe(false);
  });
});

describe("packagesForStudent", () => {
  it("gives a child their own package AND the shared one", () => {
    expect(packagesForStudent(ALL, MEMBERS, "A").map((p) => p.id)).toEqual([1, 3]);
  });

  it("gives the sibling the same shared pool, not the other child's own", () => {
    expect(packagesForStudent(ALL, MEMBERS, "B").map((p) => p.id)).toEqual([2, 3]);
  });

  it("never leaks a package to a student outside the household", () => {
    expect(packagesForStudent(ALL, MEMBERS, "Z").map((p) => p.id)).toEqual([4]);
  });

  it("gives a student with nothing an empty list rather than everything", () => {
    expect(packagesForStudent(ALL, MEMBERS, "NOBODY")).toEqual([]);
  });

  it("drops a shared pool from a sibling who was not named on it", () => {
    const soloMembers = membersByPackage([{ student_package_id: 3, student_id: "A" }]);
    expect(packagesForStudent(ALL, soloMembers, "B").map((p) => p.id)).toEqual([2]);
  });
});

describe("householdPackages", () => {
  it("counts a shared pool once, not once per child", () => {
    expect(householdPackages(ALL, MEMBERS, ["A", "B"]).map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("leaves out packages belonging to other households", () => {
    expect(householdPackages(ALL, MEMBERS, ["A", "B"]).map((p) => p.id)).not.toContain(4);
  });

  it("is empty for a household with no children yet", () => {
    expect(householdPackages(ALL, MEMBERS, [])).toEqual([]);
  });
});

describe("totalPackageHours", () => {
  it("adds purchased, used and remaining across packages", () => {
    const totals = totalPackageHours([
      pkg({ total_hours_purchased: 100, hours_used: 86.75 }),
      pkg({ total_hours_purchased: 40, hours_used: 9.25 }),
    ]);
    expect(totals).toEqual({ purchased: 140, used: 96, remaining: 44 });
  });

  it("clamps an overspent package to 0 left instead of eating another's balance", () => {
    const totals = totalPackageHours([
      pkg({ total_hours_purchased: 0, hours_used: 5 }),
      pkg({ total_hours_purchased: 20, hours_used: 0 }),
    ]);
    expect(totals.remaining).toBe(20);
    expect(totals.used).toBe(5);
  });

  it("is all zeroes for no packages", () => {
    expect(totalPackageHours([])).toEqual({ purchased: 0, used: 0, remaining: 0 });
  });
});
