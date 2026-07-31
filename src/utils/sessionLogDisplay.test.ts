import { describe, it, expect, afterEach, vi } from "vitest";
import type { ProgramType } from "../types/database";
import {
  NO_SHOW_LABELS,
  NO_SHOW_OPTIONS,
  MONTHS,
  ENGAGEMENT_COLORS,
  currentYearOptions,
  getSessionSubjectLabel,
  getProgramTypeLabel,
} from "./sessionLogDisplay";

describe("shared filter option lists", () => {
  it("labels each no-show type", () => {
    expect(NO_SHOW_LABELS).toEqual({
      no_show_1: "No Show 1",
      no_show_2: "No Show 2",
      no_show_plus: "No Show +",
    });
  });

  it("offers 'any' plus one option per no-show type", () => {
    expect(NO_SHOW_OPTIONS[0].value).toBe("any");
    expect(NO_SHOW_OPTIONS.slice(1).map((o) => o.value)).toEqual(Object.keys(NO_SHOW_LABELS));
    for (const opt of NO_SHOW_OPTIONS.slice(1)) {
      expect(opt.label).toBe(NO_SHOW_LABELS[opt.value]);
    }
  });

  it("lists the twelve months, 1-indexed to match session_date's month", () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toEqual({ value: "1", label: "January" });
    expect(MONTHS[11]).toEqual({ value: "12", label: "December" });
  });

  it("gives each engagement level a distinct colour", () => {
    expect(Object.keys(ENGAGEMENT_COLORS)).toEqual(["low", "medium", "high"]);
    expect(new Set(Object.values(ENGAGEMENT_COLORS)).size).toBe(3);
  });
});

describe("currentYearOptions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spans next year down to six years back, newest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15));
    const years = currentYearOptions().map((y) => y.value);
    expect(years).toEqual(["2027", "2026", "2025", "2024", "2023", "2022", "2021", "2020"]);
  });

  it("uses matching value and label so the select renders the year itself", () => {
    for (const y of currentYearOptions()) expect(y.label).toBe(y.value);
  });
});

describe("getSessionSubjectLabel", () => {
  const subjects = new Map([[1, "Mathematics (HL)"]]);
  const curricula = new Map([[7, "IBDP"]]);

  it("prefixes the curriculum when the session has one", () => {
    expect(getSessionSubjectLabel(1, 7, subjects, curricula)).toBe("IBDP – Mathematics (HL)");
  });

  it("shows the bare subject when there's no curriculum", () => {
    expect(getSessionSubjectLabel(1, null, subjects, curricula)).toBe("Mathematics (HL)");
  });

  it("ignores a curriculum id that isn't in the lookup", () => {
    expect(getSessionSubjectLabel(1, 99, subjects, curricula)).toBe("Mathematics (HL)");
  });

  it("shows an em dash for a session with no subject", () => {
    expect(getSessionSubjectLabel(null, 7, subjects, curricula)).toBe("—");
  });

  it("shows an em dash when the subject id isn't in the lookup", () => {
    expect(getSessionSubjectLabel(42, null, subjects, curricula)).toBe("—");
  });
});

describe("getProgramTypeLabel", () => {
  const programTypes = [
    { id: 1, name: "College Counselling", parent_id: null },
    { id: 2, name: "Essay Review", parent_id: 1 },
    { id: 3, name: "Orphaned Child", parent_id: 99 },
  ] as ProgramType[];

  it("shows a top-level program by name", () => {
    expect(getProgramTypeLabel(1, programTypes)).toBe("College Counselling");
  });

  it("qualifies a sub-program with its parent", () => {
    expect(getProgramTypeLabel(2, programTypes)).toBe("College Counselling — Essay Review");
  });

  it("falls back to the bare name when the parent is missing from the list", () => {
    expect(getProgramTypeLabel(3, programTypes)).toBe("Orphaned Child");
  });

  it("shows an em dash for no program, or an unknown one", () => {
    expect(getProgramTypeLabel(null, programTypes)).toBe("—");
    expect(getProgramTypeLabel(404, programTypes)).toBe("—");
  });
});
