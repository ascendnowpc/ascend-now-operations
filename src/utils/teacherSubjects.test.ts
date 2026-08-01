import { describe, it, expect } from "vitest";
import { mergeWithSubjects } from "./teacherSubjects";
import type { Teacher, TeacherSubject } from "../types/database";

function teacher(id: string, over: Partial<Teacher> = {}): Teacher {
  return {
    id,
    user_id: null,
    first_name: "Test",
    last_name: "Teacher",
    country: null,
    email: null,
    phone_number: null,
    is_performance_coach: false,
    is_college_counselor: false,
    is_active: true,
    ...over,
  } as Teacher;
}

function ts(id: number, teacher_id: string, subject_id: number, curriculum_id: number | null = null): TeacherSubject {
  return { id, teacher_id, subject_id, curriculum_id, created_at: "2026-01-01T00:00:00Z" };
}

describe("mergeWithSubjects", () => {
  it("attaches each teacher's own subjects and no one else's", () => {
    const map = new Map<string, TeacherSubject[]>([
      ["T1", [ts(1, "T1", 10, 5)]],
      ["T2", [ts(2, "T2", 11, null)]],
    ]);
    const merged = mergeWithSubjects([teacher("T1"), teacher("T2")], map);
    expect(merged[0].teacher_subjects).toEqual([{ id: 1, subject_id: 10, curriculum_id: 5 }]);
    expect(merged[1].teacher_subjects).toEqual([{ id: 2, subject_id: 11, curriculum_id: null }]);
  });

  it("gives a teacher with no subjects an empty array, never undefined", () => {
    const merged = mergeWithSubjects([teacher("T1")], new Map());
    expect(merged[0].teacher_subjects).toEqual([]);
  });

  it("preserves every field of the original teacher", () => {
    const t = teacher("T1", { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", is_performance_coach: true });
    const merged = mergeWithSubjects([t], new Map());
    expect(merged[0]).toMatchObject({
      id: "T1",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      is_performance_coach: true,
    });
  });

  it("keeps all of a teacher's rows when they teach several subjects", () => {
    const map = new Map([["T1", [ts(1, "T1", 10), ts(2, "T1", 11), ts(3, "T1", 12)]]]);
    expect(mergeWithSubjects([teacher("T1")], map)[0].teacher_subjects).toHaveLength(3);
  });

  it("drops the join row's teacher_id and created_at, keeping only the display fields", () => {
    const map = new Map([["T1", [ts(1, "T1", 10, 5)]]]);
    expect(Object.keys(mergeWithSubjects([teacher("T1")], map)[0].teacher_subjects![0]).sort())
      .toEqual(["curriculum_id", "id", "subject_id"]);
  });

  it("ignores map entries for teachers not in the list", () => {
    const map = new Map([["GHOST", [ts(9, "GHOST", 99)]]]);
    const merged = mergeWithSubjects([teacher("T1")], map);
    expect(merged).toHaveLength(1);
    expect(merged[0].teacher_subjects).toEqual([]);
  });

  it("returns no teachers for an empty list", () => {
    expect(mergeWithSubjects([], new Map())).toEqual([]);
  });

  it("does not mutate the teachers it was given", () => {
    const t = teacher("T1");
    mergeWithSubjects([t], new Map([["T1", [ts(1, "T1", 10)]]]));
    expect("teacher_subjects" in t).toBe(false);
  });
});
