import { describe, it, expect } from "vitest";
import {
  samePart,
  isPartSelected,
  togglePart,
  selectedPartsOf,
  buildContentScope,
} from "./contentScope";
import type { ContentScopePart } from "../types/database";

// The real shape that exposed the bug: a one-page chapter whose sections all
// sit on that same page, so every row shares the range p.3–3.
const CHAPTER = { label: "Implementation", page_start: 3, page_end: 3 };
const SECTION_1 = { label: "Implementation · 1. Opportunities for screening and follow-up", page_start: 3, page_end: 3 };
const SECTION_2 = { label: "Implementation · 2. Comprehensive guidelines", page_start: 3, page_end: 3 };
const SECTION_3 = { label: "Implementation · 3. Sustainable interventions", page_start: 3, page_end: 3 };

describe("samePart", () => {
  it("does not treat two slices sharing a page range as the same slice", () => {
    expect(samePart(SECTION_1, SECTION_2)).toBe(false);
    expect(samePart(SECTION_1, CHAPTER)).toBe(false);
  });

  it("matches a slice against itself", () => {
    expect(samePart(SECTION_1, { ...SECTION_1 })).toBe(true);
  });

  it("does not match the same label at a different page range", () => {
    expect(samePart(SECTION_1, { ...SECTION_1, page_end: 4 })).toBe(false);
  });
});

describe("isPartSelected", () => {
  it("checks only the section that was selected, not its same-page siblings", () => {
    const parts = [SECTION_1];
    expect(isPartSelected(parts, SECTION_1)).toBe(true);
    expect(isPartSelected(parts, SECTION_2)).toBe(false);
    expect(isPartSelected(parts, SECTION_3)).toBe(false);
    expect(isPartSelected(parts, CHAPTER)).toBe(false);
  });

  it("reports nothing selected for an empty selection", () => {
    expect(isPartSelected([], SECTION_1)).toBe(false);
  });
});

describe("togglePart", () => {
  it("adds a part that is not selected", () => {
    expect(togglePart([], SECTION_1)).toEqual([SECTION_1]);
  });

  it("removes a part that is selected", () => {
    expect(togglePart([SECTION_1, SECTION_2], SECTION_1)).toEqual([SECTION_2]);
  });

  it("removes only the toggled part when siblings share its page range", () => {
    const parts = [SECTION_1, SECTION_2, SECTION_3];
    expect(togglePart(parts, SECTION_2)).toEqual([SECTION_1, SECTION_3]);
  });

  it("accumulates same-page siblings instead of collapsing them", () => {
    let parts: ContentScopePart[] = [];
    parts = togglePart(parts, SECTION_1);
    parts = togglePart(parts, SECTION_2);
    parts = togglePart(parts, SECTION_3);
    expect(parts).toHaveLength(3);
  });

  it("does not mutate the array it is given", () => {
    const parts = [SECTION_1];
    togglePart(parts, SECTION_2);
    expect(parts).toEqual([SECTION_1]);
  });
});

describe("selectedPartsOf", () => {
  it("treats a null scope as whole-document — nothing selected", () => {
    expect(selectedPartsOf(null)).toEqual([]);
  });

  it("returns the parts of a multi-part scope", () => {
    const scope = { label: "x", page_start: 1, page_end: 9, parts: [SECTION_1, SECTION_2] };
    expect(selectedPartsOf(scope)).toEqual([SECTION_1, SECTION_2]);
  });

  it("treats a legacy scope with no parts as one implicit part, so it still shows as checked", () => {
    const legacy = { label: "Chapter 3", page_start: 10, page_end: 14 };
    expect(selectedPartsOf(legacy)).toEqual([{ label: "Chapter 3", page_start: 10, page_end: 14 }]);
  });

  it("treats an empty parts array as legacy rather than as nothing selected", () => {
    const scope = { label: "Chapter 3", page_start: 10, page_end: 14, parts: [] };
    expect(selectedPartsOf(scope)).toHaveLength(1);
  });
});

describe("buildContentScope", () => {
  it("returns null for no parts — the whole document", () => {
    expect(buildContentScope([])).toBeNull();
  });

  it("labels a single part with its own label and spans its pages", () => {
    expect(buildContentScope([SECTION_1])).toEqual({
      label: SECTION_1.label,
      page_start: 3,
      page_end: 3,
      parts: [SECTION_1],
    });
  });

  it("joins two parts with a semicolon", () => {
    expect(buildContentScope([SECTION_1, SECTION_2])?.label).toBe(
      `${SECTION_1.label}; ${SECTION_2.label}`
    );
  });

  it("summarises three or more as “first + N more”", () => {
    expect(buildContentScope([SECTION_1, SECTION_2, SECTION_3])?.label).toBe(
      `${SECTION_1.label} + 2 more`
    );
  });

  it("orders parts by page and spans from the earliest to the latest", () => {
    const late = { label: "Later", page_start: 20, page_end: 25 };
    const early = { label: "Earlier", page_start: 2, page_end: 4 };
    const scope = buildContentScope([late, early])!;
    expect(scope.parts?.map((p) => p.label)).toEqual(["Earlier", "Later"]);
    expect(scope.page_start).toBe(2);
    expect(scope.page_end).toBe(25);
  });

  it("spans to the widest page_end even when a later-starting part ends sooner", () => {
    const wide = { label: "Wide", page_start: 2, page_end: 30 };
    const narrow = { label: "Narrow", page_start: 5, page_end: 6 };
    const scope = buildContentScope([wide, narrow])!;
    expect(scope.page_end).toBe(30);
  });

  it("does not mutate the array it is given", () => {
    const parts = [
      { label: "Later", page_start: 20, page_end: 25 },
      { label: "Earlier", page_start: 2, page_end: 4 },
    ];
    buildContentScope(parts);
    expect(parts.map((p) => p.label)).toEqual(["Later", "Earlier"]);
  });
});
