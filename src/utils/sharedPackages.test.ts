import { describe, it, expect } from "vitest";
import {
  SHARED_PACKAGE_STUDENT_COUNT,
  shareableCourseTypes,
  isShareableCourseType,
  toggleSharedStudent,
  canSelectSharedStudent,
  sharedSelectionIssue,
  sharedStudentsForParent,
  packageCreatedNotice,
  joinNames,
  packageCreateErrorMessage,
  coSharerCandidates,
  canSellShared,
  sharedLineIssue,
  sharedWithLabel,
  pickCoSharer,
  SHARED_PACKAGE_CO_SHARER_COUNT,
} from "./sharedPackages";
import type { CourseType } from "../types/database";

function ct(over: Partial<CourseType> = {}): CourseType {
  return {
    id: 1,
    name: "Academic",
    color: "green",
    sort_order: 1,
    is_active: true,
    is_shareable: true,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const ACADEMIC = ct({ id: 1, name: "Academic", sort_order: 1, is_shareable: true });
const BEYOND = ct({ id: 2, name: "Beyond Academic", sort_order: 2, is_shareable: true });
const COLLEGE = ct({ id: 3, name: "College Counselling", sort_order: 3, is_shareable: false });
const ALL_IN_ONE = ct({ id: 5, name: "All-In-One", sort_order: 5, is_shareable: false });
const CATALOGUE = [BEYOND, COLLEGE, ACADEMIC, ALL_IN_ONE];

describe("shareableCourseTypes", () => {
  it("offers only Academic and Beyond Academic for sharing", () => {
    expect(shareableCourseTypes(CATALOGUE).map((c) => c.name)).toEqual([
      "Academic",
      "Beyond Academic",
    ]);
  });

  it("never offers a bundle, which contains a per-student College Counselling pool", () => {
    expect(shareableCourseTypes(CATALOGUE).map((c) => c.id)).not.toContain(ALL_IN_ONE.id);
  });

  it("leaves out a shareable course type that has been deactivated", () => {
    const retired = ct({ id: 9, name: "Retired", is_active: false, is_shareable: true });
    expect(shareableCourseTypes([...CATALOGUE, retired]).map((c) => c.id)).not.toContain(9);
  });

  it("offers nothing when no course type is marked shareable", () => {
    expect(shareableCourseTypes([COLLEGE, ALL_IN_ONE])).toEqual([]);
  });
});

describe("isShareableCourseType", () => {
  it("accepts Academic", () => {
    expect(isShareableCourseType(CATALOGUE, ACADEMIC.id)).toBe(true);
  });

  it("rejects College Counselling", () => {
    expect(isShareableCourseType(CATALOGUE, COLLEGE.id)).toBe(false);
  });

  it("rejects an empty pick, so an untouched form can't submit a shared package", () => {
    expect(isShareableCourseType(CATALOGUE, "")).toBe(false);
  });
});

describe("toggleSharedStudent", () => {
  it("adds a child who isn't picked yet", () => {
    expect(toggleSharedStudent([], "S1")).toEqual(["S1"]);
  });

  it("removes a child who is already picked", () => {
    expect(toggleSharedStudent(["S1", "S2"], "S1")).toEqual(["S2"]);
  });

  it("ignores a third child rather than silently dropping the first", () => {
    expect(toggleSharedStudent(["S1", "S2"], "S3")).toEqual(["S1", "S2"]);
  });

  it("still lets a picked child be unpicked once the pair is full", () => {
    expect(toggleSharedStudent(["S1", "S2"], "S2")).toEqual(["S1"]);
  });

  it("never returns more than the shared package's student count", () => {
    const full = ["S1", "S2", "S3"].reduce(toggleSharedStudent, [] as string[]);
    expect(full).toHaveLength(SHARED_PACKAGE_STUDENT_COUNT);
  });
});

describe("canSelectSharedStudent", () => {
  it("allows a child while there is room in the pair", () => {
    expect(canSelectSharedStudent(["S1"], "S2")).toBe(true);
  });

  it("locks out an unpicked child once the pair is full", () => {
    expect(canSelectSharedStudent(["S1", "S2"], "S3")).toBe(false);
  });

  it("keeps a picked child clickable so the choice can be undone", () => {
    expect(canSelectSharedStudent(["S1", "S2"], "S1")).toBe(true);
  });
});

describe("sharedSelectionIssue", () => {
  const children = [{ id: "S1" }, { id: "S2" }, { id: "S3" }];

  it("passes once exactly two children are picked", () => {
    expect(sharedSelectionIssue(children, ["S1", "S3"])).toBeNull();
  });

  it("blocks a single-child household, which can't share anything", () => {
    expect(sharedSelectionIssue([{ id: "S1" }], ["S1"])).toMatch(/this family has 1/);
  });

  it("blocks a family with no children at all", () => {
    expect(sharedSelectionIssue([], [])).toMatch(/this family has 0/);
  });

  it("blocks a half-made choice", () => {
    expect(sharedSelectionIssue(children, ["S1"])).toBe("Select 2 children.");
  });

  it("blocks a selection left over from another family", () => {
    expect(sharedSelectionIssue(children, ["S1", "OTHER-9"])).toBe("Select 2 children.");
  });
});

describe("sharedStudentsForParent", () => {
  it("drops children who don't belong to the newly picked family", () => {
    expect(sharedStudentsForParent(["S1", "OTHER-9"], [{ id: "S1" }, { id: "S2" }])).toEqual(["S1"]);
  });

  it("clears the whole selection when the family changes completely", () => {
    expect(sharedStudentsForParent(["S1", "S2"], [{ id: "T1" }])).toEqual([]);
  });
});

describe("packageCreatedNotice", () => {
  it("names both children on a shared package", () => {
    expect(
      packageCreatedNotice({ hours: 50, ownership: "shared", studentNames: ["Batu", "Elif"] }),
    ).toBe("50 hrs added — shared by Batu and Elif.");
  });

  it("names the one student on an individual package", () => {
    expect(
      packageCreatedNotice({ hours: 16, ownership: "individual", studentNames: ["Batu"] }),
    ).toBe("16 hrs added for Batu.");
  });

  it("keeps a fractional bundle total exact", () => {
    expect(
      packageCreatedNotice({ hours: 82.75, ownership: "individual", studentNames: ["Batu"] }),
    ).toBe("82.75 hrs added for Batu.");
  });

  it("still reads as a sentence when no name is available", () => {
    expect(packageCreatedNotice({ hours: 10, ownership: "shared", studentNames: [] })).toBe(
      "10 hrs added.",
    );
  });
});

describe("joinNames", () => {
  it("joins a pair with 'and'", () => {
    expect(joinNames(["Batu", "Elif"])).toBe("Batu and Elif");
  });

  it("returns a lone name unchanged", () => {
    expect(joinNames(["Batu"])).toBe("Batu");
  });

  it("returns an empty string for no names", () => {
    expect(joinNames([])).toBe("");
  });
});

describe("packageCreateErrorMessage", () => {
  it("explains a second open shared pool of the same course type", () => {
    expect(
      packageCreateErrorMessage(
        'duplicate key value violates unique constraint "student_packages_one_current_per_family_course_type"',
      ),
    ).toMatch(/family already has an open pool/);
  });

  it("explains a second open individual package of the same course type", () => {
    expect(
      packageCreateErrorMessage(
        'duplicate key value violates unique constraint "student_packages_one_current_per_course_type"',
      ),
    ).toMatch(/student already has an open package/);
  });

  it("passes a trigger's own message through, since it already says what is wrong", () => {
    const raw = "College Counselling is bought per student and cannot be shared between siblings.";
    expect(packageCreateErrorMessage(raw)).toBe(raw);
  });

  it("never paraphrases an error it doesn't recognise", () => {
    expect(packageCreateErrorMessage("connection reset")).toBe("connection reset");
  });
});

describe("coSharerCandidates", () => {
  const children = [{ id: "S1" }, { id: "S2" }, { id: "S3" }];

  it("excludes the student being invoiced — they are a member already", () => {
    expect(coSharerCandidates(children, "S2").map((c) => c.id)).toEqual(["S1", "S3"]);
  });

  it("excludes nobody on a new-student enrollment, where the child has no id yet", () => {
    expect(coSharerCandidates(children, null)).toHaveLength(3);
  });
});

describe("canSellShared", () => {
  it("allows a two-child family renewing for one of them", () => {
    expect(canSellShared("P1", [{ id: "S1" }, { id: "S2" }], "S1")).toBe(true);
  });

  it("refuses a family with only the student being invoiced", () => {
    expect(canSellShared("P1", [{ id: "S1" }], "S1")).toBe(false);
  });

  it("refuses a student with no parent account", () => {
    expect(canSellShared(null, [{ id: "S1" }, { id: "S2" }], "S1")).toBe(false);
  });

  it("allows a new student joining a household that already has one child", () => {
    expect(canSellShared("P1", [{ id: "S1" }], null)).toBe(true);
  });
});

describe("sharedLineIssue", () => {
  const children = [{ id: "S1" }, { id: "S2" }, { id: "S3" }];

  it("passes once the other child is picked", () => {
    expect(sharedLineIssue("P1", children, "S1", ["S2"])).toBeNull();
  });

  it("asks for the family first when none is linked", () => {
    expect(sharedLineIssue(null, children, "S1", ["S2"])).toMatch(/Pick the family/);
  });

  it("says a one-child family has nobody to share with", () => {
    expect(sharedLineIssue("P1", [{ id: "S1" }], "S1", [])).toMatch(/no one else to share with/);
  });

  it("blocks an empty pick", () => {
    expect(sharedLineIssue("P1", children, "S1", [])).toBe("Select the other child to share with.");
  });

  it("blocks picking the student being invoiced as their own co-sharer", () => {
    expect(sharedLineIssue("P1", children, "S1", ["S1"])).toBe("Select the other child to share with.");
  });

  it("blocks a child from another household", () => {
    expect(sharedLineIssue("P1", children, "S1", ["OTHER-9"])).toBe("Select the other child to share with.");
  });

  it("blocks two co-sharers, which would make three members", () => {
    expect(sharedLineIssue("P1", children, "S1", ["S2", "S3"])).toBe("Select the other child to share with.");
  });
});

describe("sharedWithLabel", () => {
  it("names the co-sharer on a shared package", () => {
    expect(sharedWithLabel(true, ["Elif"])).toBe("Shared with Elif");
  });

  it("says nothing at all for an individual package", () => {
    expect(sharedWithLabel(false, ["Elif"])).toBeNull();
  });

  it("still marks a shared package whose co-sharer name is unavailable", () => {
    expect(sharedWithLabel(true, [])).toBe("Shared");
  });
});

describe("pickCoSharer", () => {
  it("picks a child when nothing is chosen", () => {
    expect(pickCoSharer([], "S2")).toEqual(["S2"]);
  });

  it("clears the child when they are clicked again", () => {
    expect(pickCoSharer(["S2"], "S2")).toEqual([]);
  });

  it("replaces the existing pick rather than ignoring the click", () => {
    expect(pickCoSharer(["S2"], "S3")).toEqual(["S3"]);
  });

  it("never holds more co-sharers than a shared package has room for", () => {
    const after = ["S2", "S3", "S4"].reduce(pickCoSharer, [] as string[]);
    expect(after).toHaveLength(SHARED_PACKAGE_CO_SHARER_COUNT);
  });
});
