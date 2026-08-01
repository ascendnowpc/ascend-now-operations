import { describe, it, expect } from "vitest";
import { subjectDisplayLabel, subjectBaseLabel, groupSubjectsByBase } from "./subjectGrouping";
import type { Subject } from "../types/database";

function subject(over: Partial<Subject> = {}): Subject {
  return {
    id: 1,
    name: "Biology",
    category: "sciences",
    category_id: null,
    curriculum_group_id: null,
    curriculum_id: null,
    board: null,
    subject_code: null,
    level: null,
    sort_order: 0,
    is_active: true,
    ...over,
  } as Subject;
}

describe("subjectDisplayLabel", () => {
  it("shows board and code together in brackets when both are known", () => {
    expect(subjectDisplayLabel("Biology", "Cambridge", "0610", "Higher Level"))
      .toBe("Biology — Cambridge (0610) — Higher Level");
  });

  it("shows the board alone when there is no subject code", () => {
    expect(subjectDisplayLabel("Biology", "Cambridge", null, "Higher Level"))
      .toBe("Biology — Cambridge — Higher Level");
  });

  it("omits a subject code that has no board to attach to", () => {
    expect(subjectDisplayLabel("Biology", null, "0610", null)).toBe("Biology");
  });

  it("falls back to the bare name when nothing else is known", () => {
    expect(subjectDisplayLabel("Biology", null, null, null)).toBe("Biology");
  });

  it("appends the level even with no board", () => {
    expect(subjectDisplayLabel("Biology", null, null, "Standard Level")).toBe("Biology — Standard Level");
  });

  it("treats empty strings as missing rather than rendering empty segments", () => {
    expect(subjectDisplayLabel("Biology", "", "", "")).toBe("Biology");
  });
});

describe("subjectBaseLabel", () => {
  it("matches the display label minus the level", () => {
    expect(subjectBaseLabel("Biology", "Cambridge", "0610")).toBe("Biology — Cambridge (0610)");
  });

  it("never includes a level, so SL and HL share one base label", () => {
    expect(subjectBaseLabel("English", null, null)).toBe("English");
  });
});

describe("groupSubjectsByBase", () => {
  it("collapses the same subject at two levels into one group", () => {
    const groups = groupSubjectsByBase([
      subject({ id: 1, name: "English", level: "Standard Level" }),
      subject({ id: 2, name: "English", level: "Higher Level" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].baseLabel).toBe("English");
    expect(groups[0].items).toHaveLength(2);
  });

  it("sorts the levels within a group alphabetically for a stable dropdown", () => {
    const groups = groupSubjectsByBase([
      subject({ id: 1, name: "English", level: "Standard Level" }),
      subject({ id: 2, name: "English", level: "Higher Level" }),
    ]);
    expect(groups[0].items.map((s) => s.level)).toEqual(["Higher Level", "Standard Level"]);
  });

  it("keeps different subject names in separate groups", () => {
    const groups = groupSubjectsByBase([
      subject({ id: 1, name: "English" }),
      subject({ id: 2, name: "Maths" }),
    ]);
    expect(groups.map((g) => g.baseLabel)).toEqual(["English", "Maths"]);
  });

  it("keeps the same subject name under different boards apart", () => {
    const groups = groupSubjectsByBase([
      subject({ id: 1, name: "Biology", board: "Cambridge" }),
      subject({ id: 2, name: "Biology", board: "Pearson Edexcel" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("keeps the same subject and board under different codes apart", () => {
    const groups = groupSubjectsByBase([
      subject({ id: 1, name: "Maths", board: "Cambridge", subject_code: "0580" }),
      subject({ id: 2, name: "Maths", board: "Cambridge", subject_code: "9709" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.baseLabel)).toEqual(["Maths — Cambridge (0580)", "Maths — Cambridge (9709)"]);
  });

  it("groups a subject with a null level alongside its levelled siblings", () => {
    const groups = groupSubjectsByBase([
      subject({ id: 1, name: "English", level: null }),
      subject({ id: 2, name: "English", level: "Higher Level" }),
    ]);
    expect(groups).toHaveLength(1);
    // Null levels sort first, since they compare as the empty string.
    expect(groups[0].items.map((s) => s.level)).toEqual([null, "Higher Level"]);
  });

  it("preserves first-seen group order", () => {
    const groups = groupSubjectsByBase([
      subject({ id: 1, name: "Zoology" }),
      subject({ id: 2, name: "Art" }),
      subject({ id: 3, name: "Zoology", level: "Higher Level" }),
    ]);
    expect(groups.map((g) => g.baseLabel)).toEqual(["Zoology", "Art"]);
    expect(groups[0].items).toHaveLength(2);
  });

  it("returns no groups for no subjects", () => {
    expect(groupSubjectsByBase([])).toEqual([]);
  });
});
