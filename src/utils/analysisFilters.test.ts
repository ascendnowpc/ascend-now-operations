import { describe, it, expect } from "vitest";
import { defaultAnalysisFilters, hasActiveFilters } from "./analysisFilters";
import { DEFAULT_DATE_RANGE_PRESET } from "./dateRangePresets";

describe("defaultAnalysisFilters", () => {
  it("starts on the default date range with every list empty", () => {
    expect(defaultAnalysisFilters()).toEqual({
      preset: DEFAULT_DATE_RANGE_PRESET,
      teacherIds: [],
      coordinatorIds: [],
      countries: [],
      studentIds: [],
    });
  });

  it("leaves the optional single-value filters unset", () => {
    const f = defaultAnalysisFilters();
    expect(f.noShowType).toBeUndefined();
    expect(f.flagged).toBeUndefined();
    expect(f.engagementRating).toBeUndefined();
  });

  it("returns a fresh object each call, so mutating one view never affects another", () => {
    const a = defaultAnalysisFilters();
    a.teacherIds.push("T1");
    expect(defaultAnalysisFilters().teacherIds).toEqual([]);
  });
});

describe("hasActiveFilters", () => {
  it("reports the untouched default as inactive", () => {
    expect(hasActiveFilters(defaultAnalysisFilters())).toBe(false);
  });

  it("counts a changed date range as an active filter", () => {
    expect(hasActiveFilters({ ...defaultAnalysisFilters(), preset: "30d" })).toBe(true);
  });

  it("counts a selection in any of the multi-select filters", () => {
    const base = defaultAnalysisFilters();
    expect(hasActiveFilters({ ...base, teacherIds: ["T1"] })).toBe(true);
    expect(hasActiveFilters({ ...base, coordinatorIds: ["C1"] })).toBe(true);
    expect(hasActiveFilters({ ...base, countries: ["UAE"] })).toBe(true);
    expect(hasActiveFilters({ ...base, studentIds: ["S1"] })).toBe(true);
  });

  it("counts each of the optional single-value filters", () => {
    const base = defaultAnalysisFilters();
    expect(hasActiveFilters({ ...base, noShowType: "any" })).toBe(true);
    expect(hasActiveFilters({ ...base, flagged: "no" })).toBe(true);
    expect(hasActiveFilters({ ...base, engagementRating: "low" })).toBe(true);
  });

  it("stays inactive when an optional filter is explicitly cleared to undefined", () => {
    expect(hasActiveFilters({ ...defaultAnalysisFilters(), noShowType: undefined, flagged: undefined })).toBe(false);
  });

  it("ignores custom dates that are set while the preset is still the default", () => {
    // The custom range only takes effect under the "custom" preset, which is
    // itself a non-default preset and so is already caught above.
    expect(hasActiveFilters({ ...defaultAnalysisFilters(), customFrom: "2026-01-01", customTo: "2026-02-01" })).toBe(false);
  });
});
