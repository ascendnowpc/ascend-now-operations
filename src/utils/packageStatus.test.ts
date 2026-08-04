import { describe, it, expect } from "vitest";
import {
  usageUnits,
  statusForFraction,
  packageStatusOf,
  type PackageUsageRow,
} from "./packageStatus";

// Batu's real All-In-One (course type 5): five pools under one purchase, of
// which only two have been touched at all.
const ALL_IN_ONE: PackageUsageRow[] = [
  { package_type_id: 5, total_hours_purchased: 32, hours_used: 1.25 },
  { package_type_id: 5, total_hours_purchased: 24, hours_used: 0 },
  { package_type_id: 5, total_hours_purchased: 16, hours_used: 0 },
  { package_type_id: 5, total_hours_purchased: 10, hours_used: 0 },
  { package_type_id: 5, total_hours_purchased: 40, hours_used: 9.25 },
];

describe("usageUnits", () => {
  it("sums a bundle's pools into one unit — an All-In-One is one purchase", () => {
    const units = usageUnits(ALL_IN_ONE);
    expect(units).toHaveLength(1);
    expect(units[0].purchased).toBe(122);
    expect(units[0].used).toBe(10.5);
  });

  it("keeps each standalone package its own unit", () => {
    const units = usageUnits([
      { package_type_id: null, total_hours_purchased: 100, hours_used: 85.75 },
      { package_type_id: null, total_hours_purchased: 40, hours_used: 2 },
    ]);
    expect(units).toHaveLength(2);
  });

  it("keeps two different bundles apart", () => {
    const units = usageUnits([
      { package_type_id: 4, total_hours_purchased: 10, hours_used: 10 },
      { package_type_id: 5, total_hours_purchased: 10, hours_used: 0 },
    ]);
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.key)).toEqual(["bundle:4", "bundle:5"]);
  });

  it("mixes a bundle and a standalone package in one student", () => {
    expect(
      usageUnits([...ALL_IN_ONE, { package_type_id: null, total_hours_purchased: 100, hours_used: 85.75 }])
    ).toHaveLength(2);
  });

  it("coerces the numeric strings PostgREST returns", () => {
    const units = usageUnits([
      { package_type_id: 5, total_hours_purchased: "32", hours_used: "1.25" },
      { package_type_id: 5, total_hours_purchased: "24", hours_used: "0" },
    ]);
    expect(units[0]).toMatchObject({ purchased: 56, used: 1.25 });
  });

  it("treats an unparseable value as zero rather than NaN", () => {
    const units = usageUnits([{ package_type_id: null, total_hours_purchased: "", hours_used: "oops" }]);
    expect(units[0]).toMatchObject({ purchased: 0, used: 0 });
  });

  it("returns nothing for a student with no packages", () => {
    expect(usageUnits([])).toEqual([]);
  });
});

describe("statusForFraction", () => {
  it.each([
    [0, "under_50"],
    [0.49, "under_50"],
    [0.5, "between_50_75"],
    [0.74, "between_50_75"],
    [0.75, "between_75_100"],
    [0.99, "between_75_100"],
    [1, "completed_or_over"],
    [1.5, "completed_or_over"],
  ])("puts %s in %s", (fraction, expected) => {
    expect(statusForFraction(fraction)).toBe(expected);
  });
});

describe("packageStatusOf", () => {
  it("judges an All-In-One on the whole bundle, not its emptiest pool", () => {
    // 10.5 of 122 hours = 8.6% — healthy. Scoring pools separately used to
    // read this as 23% (9.25/40), and any exhausted pool as 100%.
    expect(packageStatusOf(ALL_IN_ONE)).toBe("under_50");
  });

  it("does not mark a bundle done just because one pool is exhausted", () => {
    const bundle: PackageUsageRow[] = [
      { package_type_id: 5, total_hours_purchased: 10, hours_used: 10 }, // spent
      { package_type_id: 5, total_hours_purchased: 90, hours_used: 0 },
    ];
    expect(packageStatusOf(bundle)).toBe("under_50");
  });

  it("marks a bundle done when the bundle as a whole is spent", () => {
    const bundle: PackageUsageRow[] = [
      { package_type_id: 5, total_hours_purchased: 10, hours_used: 10 },
      { package_type_id: 5, total_hours_purchased: 90, hours_used: 90 },
    ];
    expect(packageStatusOf(bundle)).toBe("completed_or_over");
  });

  it("still reports the worst unit across separate purchases", () => {
    // The All-In-One is healthy but the standalone Academic package is at 86%.
    const packages = [...ALL_IN_ONE, { package_type_id: null, total_hours_purchased: 100, hours_used: 85.75 }];
    expect(packageStatusOf(packages)).toBe("between_75_100");
  });

  it("returns 'none' for a student with no packages", () => {
    expect(packageStatusOf([])).toBe("none");
  });

  it("counts over-use beyond the purchased hours as completed", () => {
    expect(packageStatusOf([{ package_type_id: null, total_hours_purchased: 10, hours_used: 12 }])).toBe(
      "completed_or_over"
    );
  });

  it("treats a zero-hour package as unused instead of dividing by zero", () => {
    expect(packageStatusOf([{ package_type_id: null, total_hours_purchased: 0, hours_used: 0 }])).toBe(
      "under_50"
    );
  });
});
