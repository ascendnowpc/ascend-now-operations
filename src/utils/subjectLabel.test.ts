import { describe, it, expect } from "vitest";
import { levelAbbrev, subjectLabel, sessionTopicLabel } from "./subjectLabel";

describe("levelAbbrev — level → conventional short form", () => {
  it("abbreviates the levels that have a conventional short form", () => {
    expect(levelAbbrev("Higher Level")).toBe("HL");
    expect(levelAbbrev("Standard Level")).toBe("SL");
    expect(levelAbbrev("Advanced Subsidiary Level")).toBe("AS");
    expect(levelAbbrev("Advanced Level")).toBe("A2");
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(levelAbbrev("  higher level ")).toBe("HL");
    expect(levelAbbrev("STANDARD LEVEL")).toBe("SL");
  });

  it("keeps levels that are already short as-is", () => {
    expect(levelAbbrev("Core")).toBe("Core");
    expect(levelAbbrev("Extended")).toBe("Extended");
    expect(levelAbbrev("Foundation")).toBe("Foundation");
  });

  it("passes an unrecognised level through unchanged rather than dropping it", () => {
    expect(levelAbbrev("Grade 9")).toBe("Grade 9");
  });

  it("returns null when there's no level", () => {
    expect(levelAbbrev(null)).toBeNull();
    expect(levelAbbrev(undefined)).toBeNull();
    expect(levelAbbrev("")).toBeNull();
  });
});

describe("subjectLabel — subjects that differ only by level stay distinguishable", () => {
  it("appends the abbreviated level in brackets", () => {
    expect(subjectLabel("Mathematics", "Higher Level")).toBe("Mathematics (HL)");
    expect(subjectLabel("Mathematics", "Standard Level")).toBe("Mathematics (SL)");
  });

  it("shows the bare name when the subject has no level", () => {
    expect(subjectLabel("Economics", null)).toBe("Economics");
    expect(subjectLabel("Economics", undefined)).toBe("Economics");
    expect(subjectLabel("Economics", "")).toBe("Economics");
  });
});

describe("sessionTopicLabel — subject → topic → program fallback", () => {
  it("prefers the subject, with its level", () => {
    expect(
      sessionTopicLabel({
        subjectName: "Physics",
        subjectLevel: "Higher Level",
        topic: "Kinematics",
        programName: "IBDP",
      })
    ).toBe("Physics (HL)");
  });

  it("falls back to the topic when there's no subject", () => {
    expect(
      sessionTopicLabel({ subjectName: null, topic: "Common App essay", programName: "College Essays" })
    ).toBe("Common App essay");
  });

  it("falls back to the program name for sessions that carry no subject or topic", () => {
    expect(sessionTopicLabel({ programName: "College Counselling" })).toBe("College Counselling");
  });

  it("renders an em dash only when there's genuinely nothing to show", () => {
    expect(sessionTopicLabel({})).toBe("—");
    expect(sessionTopicLabel({ subjectName: null, topic: null, programName: null })).toBe("—");
  });
});
