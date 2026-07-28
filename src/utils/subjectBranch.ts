// The three top-level branches every subject lives under — see
// db/docs/SUBJECT_HIERARCHY.md §1. Which branch a subject belongs to is read off
// its `category`: 'academic' and 'college_counselling' are exact, and
// everything else ('beyond_academic', 'passion_projects', 'profile_building', …)
// is the loose Beyond Academic catch-all. Used by the teacher Notes page; it
// mirrors the same branch logic the student Overview tab keys its subjects by,
// so a note filed here lands on the matching Overview subject.
export type BranchKey = "academic" | "beyond_academic" | "college_counselling";

export function branchOfCategory(category: string | null): BranchKey {
  if (category === "academic") return "academic";
  if (category === "college_counselling") return "college_counselling";
  return "beyond_academic";
}

// A student's package course_type_id maps 1:1 to a branch (verified live:
// Academic = 1, Beyond Academic = 2, College Counselling = 3).
export function branchOfCourseType(courseTypeId: number | null): BranchKey | null {
  if (courseTypeId === 1) return "academic";
  if (courseTypeId === 2) return "beyond_academic";
  if (courseTypeId === 3) return "college_counselling";
  return null;
}

export const BRANCH_TITLES: Record<BranchKey, string> = {
  academic: "Academic",
  beyond_academic: "Beyond Academic",
  college_counselling: "College Counselling",
};

export const BRANCH_ORDER: BranchKey[] = ["academic", "beyond_academic", "college_counselling"];
