import { describe, it, expect } from "vitest";
import { branchOfCategory, branchOfCourseType } from "./subjectBranch";

describe("branchOfCategory — subject → branch bucketing", () => {
  it("maps the two exact categories", () => {
    expect(branchOfCategory("academic")).toBe("academic");
    expect(branchOfCategory("college_counselling")).toBe("college_counselling");
  });

  it("buckets everything else (incl. null) into Beyond Academic", () => {
    expect(branchOfCategory("beyond_academic")).toBe("beyond_academic");
    expect(branchOfCategory("passion_projects")).toBe("beyond_academic");
    expect(branchOfCategory("profile_building")).toBe("beyond_academic");
    expect(branchOfCategory(null)).toBe("beyond_academic");
  });
});

describe("branchOfCourseType — 1:1 course_type_id → branch", () => {
  it("maps the three known course types", () => {
    expect(branchOfCourseType(1)).toBe("academic");
    expect(branchOfCourseType(2)).toBe("beyond_academic");
    expect(branchOfCourseType(3)).toBe("college_counselling");
  });

  it("returns null for a bundle/unknown course type (e.g. Foundation Program / All-In-One)", () => {
    expect(branchOfCourseType(4)).toBeNull();
    expect(branchOfCourseType(null)).toBeNull();
  });
});
