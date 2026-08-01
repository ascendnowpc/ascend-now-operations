import { describe, it, expect } from "vitest";
import { teacherFilterOptions, teacherLabel } from "./teacherOptions";

function t(over: Partial<Parameters<typeof teacherFilterOptions>[0][number]> = {}) {
  return {
    id: "ABCX26-1",
    first_name: "Ada",
    last_name: "Lovelace",
    is_active: true,
    is_performance_coach: false,
    ...over,
  };
}

describe("teacherLabel", () => {
  it("joins first and last name", () => {
    expect(teacherLabel({ first_name: "Ada", last_name: "Lovelace" })).toBe("Ada Lovelace");
  });

  it("collapses the double space a trailing-space first name would leave", () => {
    expect(teacherLabel({ first_name: "Sumer ", last_name: "Broota" })).toBe("Sumer Broota");
  });

  it("falls back to whichever name is present rather than leaving a stray space", () => {
    expect(teacherLabel({ first_name: "Anugya", last_name: "" })).toBe("Anugya");
    expect(teacherLabel({ first_name: "", last_name: "Sajjad" })).toBe("Sajjad");
    expect(teacherLabel({ first_name: "", last_name: "" })).toBe("");
  });
});

describe("teacherFilterOptions — a deactivated teacher is never offered", () => {
  it("drops inactive staff", () => {
    const opts = teacherFilterOptions([
      t({ id: "SUMB26-19", first_name: "Sumer ", last_name: "Broota" }),
      t({ id: "TESC26-18", first_name: "test", last_name: "cc", is_active: false }),
    ]);
    expect(opts).toEqual([{ value: "SUMB26-19", label: "Sumer Broota" }]);
  });

  it("keeps active staff regardless of role", () => {
    const opts = teacherFilterOptions([
      t({ id: "A", is_performance_coach: true }),
      t({ id: "B", is_performance_coach: false }),
    ]);
    expect(opts.map((o) => o.value)).toEqual(["A", "B"]);
  });

  it("returns an empty list when every teacher is deactivated", () => {
    expect(teacherFilterOptions([t({ is_active: false })])).toEqual([]);
    expect(teacherFilterOptions([])).toEqual([]);
  });

  it("preserves the caller's ordering", () => {
    const opts = teacherFilterOptions([t({ id: "Z" }), t({ id: "A" }), t({ id: "M" })]);
    expect(opts.map((o) => o.value)).toEqual(["Z", "A", "M"]);
  });
});

describe("teacherFilterOptions — performanceCoachesOnly", () => {
  it("narrows to coaches", () => {
    const opts = teacherFilterOptions(
      [
        t({ id: "COACH", is_performance_coach: true }),
        t({ id: "PLAIN", is_performance_coach: false }),
      ],
      { performanceCoachesOnly: true }
    );
    expect(opts.map((o) => o.value)).toEqual(["COACH"]);
  });

  it("still excludes a deactivated coach — both rules apply, not either", () => {
    const opts = teacherFilterOptions(
      [t({ id: "GONE", is_performance_coach: true, is_active: false })],
      { performanceCoachesOnly: true }
    );
    expect(opts).toEqual([]);
  });

  it("is off by default, so a plain teacher survives", () => {
    expect(teacherFilterOptions([t({ id: "PLAIN" })]).map((o) => o.value)).toEqual(["PLAIN"]);
  });
});
