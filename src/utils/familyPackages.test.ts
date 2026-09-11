import { describe, it, expect } from "vitest";
import {
  isFamilyPackage,
  packagesAvailableToStudent,
  packageUsageSplit,
  studentHoursUsed,
  studentPackageTotals,
  siblingColorMap,
  siblingColor,
  familyColorOrder,
  UNKNOWN_SIBLING_COLOR,
  type SiblingUsage,
} from "./familyPackages";
import type { StudentPackage, Student } from "../types/database";

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

function stu(id: string, parentId: string | null): Pick<Student, "id" | "parent_id"> {
  return { id, parent_id: parentId };
}

function usage(over: Partial<SiblingUsage> = {}): SiblingUsage {
  return {
    studentId: "ELD26-1",
    firstName: "Elder",
    lastName: "Khan",
    sessions: 1,
    noShows: 0,
    hours: 1,
    ...over,
  };
}

describe("isFamilyPackage", () => {
  it("is a family package when a parent owns it", () => {
    expect(isFamilyPackage(pkg({ parent_id: "SARK26-1" }))).toBe(true);
  });

  it("is not one when a student owns it", () => {
    expect(isFamilyPackage(pkg({ student_id: "ELD26-1" }))).toBe(false);
  });
});

describe("packagesAvailableToStudent — what a child may draw on", () => {
  it("includes the student's own packages", () => {
    const packages = [pkg({ id: 1, student_id: "ELD26-1" })];
    expect(packagesAvailableToStudent(packages, stu("ELD26-1", "SARK26-1")).map((p) => p.id)).toEqual([1]);
  });

  it("includes their family's packages", () => {
    const packages = [pkg({ id: 2, parent_id: "SARK26-1" })];
    expect(packagesAvailableToStudent(packages, stu("ELD26-1", "SARK26-1")).map((p) => p.id)).toEqual([2]);
  });

  it("gives both siblings the same family pool", () => {
    const packages = [pkg({ id: 2, parent_id: "SARK26-1" })];
    expect(packagesAvailableToStudent(packages, stu("ELD26-1", "SARK26-1"))).toHaveLength(1);
    expect(packagesAvailableToStudent(packages, stu("YNG26-2", "SARK26-1"))).toHaveLength(1);
  });

  it("excludes another family's pool and another student's own package", () => {
    const packages = [
      pkg({ id: 3, parent_id: "OTHR26-9" }),
      pkg({ id: 4, student_id: "SOME26-8" }),
    ];
    expect(packagesAvailableToStudent(packages, stu("ELD26-1", "SARK26-1"))).toEqual([]);
  });

  it("gives a student with no parent only their own packages", () => {
    const packages = [pkg({ id: 1, student_id: "ELD26-1" }), pkg({ id: 2, parent_id: "SARK26-1" })];
    expect(packagesAvailableToStudent(packages, stu("ELD26-1", null)).map((p) => p.id)).toEqual([1]);
  });
});

describe("packageUsageSplit — who spent the family's hours", () => {
  it("splits usage between siblings as a share of hours purchased", () => {
    const split = packageUsageSplit(
      [usage({ studentId: "ELD26-1", hours: 5 }), usage({ studentId: "YNG26-2", hours: 5.5 })],
      50,
    );
    expect(split.usedHours).toBe(10.5);
    expect(split.remainingHours).toBe(39.5);
    // 5/50 and 5.5/50 — of what was BOUGHT, not of what was spent.
    expect(split.slices.map((s) => s.percent)).toEqual([11, 10]);
    expect(split.remainingPercent).toBe(79);
    expect(split.overspent).toBe(false);
  });

  it("orders slices largest first, tie-broken by student id so the order is stable", () => {
    const split = packageUsageSplit(
      [
        usage({ studentId: "AAA26-1", hours: 2 }),
        usage({ studentId: "ZZZ26-9", hours: 8 }),
        usage({ studentId: "BBB26-2", hours: 2 }),
      ],
      20,
    );
    expect(split.slices.map((s) => s.studentId)).toEqual(["ZZZ26-9", "AAA26-1", "BBB26-2"]);
  });

  it("normalises to hours used once the package is overspent, so slices still fill the bar once", () => {
    const split = packageUsageSplit(
      [usage({ studentId: "ELD26-1", hours: 6 }), usage({ studentId: "YNG26-2", hours: 6 })],
      10,
    );
    expect(split.overspent).toBe(true);
    expect(split.slices.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100);
    expect(split.remainingHours).toBe(0);
    expect(split.remainingPercent).toBe(0);
  });

  it("handles the zero-hour overage pool without dividing by zero", () => {
    const split = packageUsageSplit([usage({ hours: 3 })], 0);
    expect(split.overspent).toBe(true);
    expect(split.slices[0].percent).toBe(100);
    expect(split.remainingPercent).toBe(0);
  });

  it("reports an untouched package as fully remaining", () => {
    const split = packageUsageSplit([], 40);
    expect(split.usedHours).toBe(0);
    expect(split.slices).toEqual([]);
    expect(split.remainingPercent).toBe(100);
    expect(split.overspent).toBe(false);
  });

  it("counts no-shows in the slice without letting a non-billable one add hours", () => {
    // The caller (the SQL RPC) already applies the No Show 1/2 rule to `hours`;
    // this just checks the counts travel through untouched.
    const split = packageUsageSplit([usage({ sessions: 2, noShows: 1, hours: 4 })], 10);
    expect(split.slices[0].sessions).toBe(2);
    expect(split.slices[0].noShows).toBe(1);
    expect(split.usedHours).toBe(4);
  });
});

describe("siblingColorMap — a child keeps their colour everywhere", () => {
  it("assigns by position in the family, so the eldest is always the first colour", () => {
    const map = siblingColorMap(["ELD26-1", "YNG26-2"]);
    expect(siblingColor(map, "ELD26-1")).not.toEqual(siblingColor(map, "YNG26-2"));
    // Same family, recomputed elsewhere in the app — same answer.
    expect(siblingColorMap(["ELD26-1", "YNG26-2"]).get("YNG26-2")).toEqual(map.get("YNG26-2"));
  });

  it("keeps the earlier children's colours when a new sibling is added", () => {
    const before = siblingColorMap(["ELD26-1", "YNG26-2"]);
    const after = siblingColorMap(["ELD26-1", "YNG26-2", "BAB26-3"]);
    expect(after.get("ELD26-1")).toEqual(before.get("ELD26-1"));
    expect(after.get("YNG26-2")).toEqual(before.get("YNG26-2"));
  });

  it("wraps rather than running out for a very large family", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `KID26-${i + 1}`);
    const map = siblingColorMap(ids);
    expect(map.size).toBe(8);
    expect(map.get("KID26-7")).toEqual(map.get("KID26-1"));
  });

  it("falls back to a neutral colour for a student not in the family list", () => {
    expect(siblingColor(siblingColorMap(["ELD26-1"]), "NOPE26-9")).toEqual(UNKNOWN_SIBLING_COLOR);
  });
});

describe("studentHoursUsed — one child's hours out of a shared pool", () => {
  // The shape that started this: a parent looking at one child's Activity page
  // saw the pool's 87.5 hrs, of which 0.75 were the sibling's.
  const shared = pkg({ id: 7, parent_id: "SARK26-1", total_hours_purchased: 100, hours_used: 87.5 });
  const split = new Map([[7, [
    usage({ studentId: "ELD26-1", firstName: "Elder", hours: 86.75 }),
    usage({ studentId: "YNG26-2", firstName: "Younger", hours: 0.75 }),
  ]]]);

  it("reports only the hours this child spent, not the pool's total", () => {
    expect(studentHoursUsed(shared, "ELD26-1", split)).toBe(86.75);
    expect(studentHoursUsed(shared, "YNG26-2", split)).toBe(0.75);
  });

  it("is zero for a sibling who has never drawn on the pool", () => {
    expect(studentHoursUsed(shared, "THIRD26-3", split)).toBe(0);
  });

  it("uses the stored hours_used for a student-owned pool", () => {
    const own = pkg({ id: 8, student_id: "ELD26-1", hours_used: 12 });
    expect(studentHoursUsed(own, "ELD26-1", new Map())).toBe(12);
  });

  it("falls back to the pool total when a used pool has no usage rows yet", () => {
    // Hours on the pool guarantee at least one usage row — none means the
    // aggregate hasn't loaded, and a confident 0 would be a wrong number
    // rather than a missing one.
    expect(studentHoursUsed(shared, "ELD26-1", new Map())).toBe(87.5);
    expect(studentHoursUsed(shared, "ELD26-1", new Map([[7, []]]))).toBe(87.5);
  });

  it("is zero on an untouched shared pool rather than falling back", () => {
    const untouched = pkg({ id: 9, parent_id: "SARK26-1", hours_used: 0 });
    expect(studentHoursUsed(untouched, "ELD26-1", new Map())).toBe(0);
  });
});

describe("studentPackageTotals — a child's headline numbers", () => {
  const packages = [
    pkg({ id: 7, parent_id: "SARK26-1", total_hours_purchased: 100, hours_used: 87.5 }),
    pkg({ id: 8, student_id: "ELD26-1", total_hours_purchased: 40, hours_used: 9.25 }),
  ];
  const split = new Map([[7, [
    usage({ studentId: "ELD26-1", hours: 86.75 }),
    usage({ studentId: "YNG26-2", hours: 0.75 }),
  ]]]);

  it("counts only this child's hours as used", () => {
    expect(studentPackageTotals(packages, "ELD26-1", split).used).toBe(96);
  });

  it("counts every sibling's spending against what is left to book", () => {
    // 12.5 left of the shared pool even though this child spent 86.75 of it.
    expect(studentPackageTotals(packages, "ELD26-1", split).remaining).toBe(43.25);
    expect(studentPackageTotals(packages, "ELD26-1", split).purchased).toBe(140);
  });

  it("gives the same remaining whichever sibling is being viewed", () => {
    expect(studentPackageTotals(packages, "YNG26-2", split).remaining).toBe(43.25);
  });

  it("counts nothing from a pool another student owns outright", () => {
    // The sibling's own 40-hour pool is not the family's to spend.
    expect(studentPackageTotals(packages, "YNG26-2", split).used).toBe(0.75);
  });

  it("clamps an overspent pool at zero instead of eating another pool's hours", () => {
    const overspent = [
      pkg({ id: 1, student_id: "ELD26-1", total_hours_purchased: 10, hours_used: 14 }),
      pkg({ id: 2, student_id: "ELD26-1", total_hours_purchased: 20, hours_used: 0 }),
    ];
    expect(studentPackageTotals(overspent, "ELD26-1", new Map()).remaining).toBe(20);
  });

  it("is all zeroes with no packages", () => {
    expect(studentPackageTotals([], "ELD26-1", new Map())).toEqual({
      purchased: 0,
      used: 0,
      remaining: 0,
    });
  });
});

describe("familyColorOrder — the same colours without sibling read access", () => {
  it("orders by enrollment sequence read off the id, not alphabetically", () => {
    // A student can't read their sibling's row, so the trailing sequence
    // number of the id is the only ordering available to them — and it is the
    // same one childrenOf() gives an admin.
    const order = familyColorOrder([
      [usage({ studentId: "ZOYK26-2" }), usage({ studentId: "AYAK26-11" })],
    ]);
    expect(order).toEqual(["ZOYK26-2", "AYAK26-11"]);
  });

  it("takes the union across every package, so a pool one sibling skipped doesn't reshuffle colours", () => {
    const order = familyColorOrder([
      [usage({ studentId: "ELD26-1" })],
      [usage({ studentId: "ELD26-1" }), usage({ studentId: "YNG26-2" })],
    ]);
    expect(order).toEqual(["ELD26-1", "YNG26-2"]);
  });

  it("gives each child the same colour whichever package is drawn", () => {
    const order = familyColorOrder([
      [usage({ studentId: "ELD26-1" }), usage({ studentId: "YNG26-2" })],
    ]);
    const colors = siblingColorMap(order);
    // Recomputed from a package only the younger sibling used — same colour.
    const orderElsewhere = familyColorOrder([
      [usage({ studentId: "ELD26-1" }), usage({ studentId: "YNG26-2" })],
      [usage({ studentId: "YNG26-2" })],
    ]);
    expect(siblingColorMap(orderElsewhere).get("YNG26-2")).toEqual(colors.get("YNG26-2"));
  });

  it("is empty when nobody has used anything yet", () => {
    expect(familyColorOrder([])).toEqual([]);
    expect(familyColorOrder([[]])).toEqual([]);
  });
});
