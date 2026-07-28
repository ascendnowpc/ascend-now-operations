import { describe, it, expect } from "vitest";
import {
  stripOptionLabel,
  gradeEffectiveMark,
  gradeEffectiveTotal,
  gradeMaxTotal,
  hasPendingManualGrade,
  homeworkStage,
} from "./homeworkGrading";

describe("stripOptionLabel — remove baked-in enumerators from MCQ options", () => {
  it("strips a leading enumerator with a delimiter", () => {
    expect(stripOptionLabel("1. A vacuum")).toBe("A vacuum");
    expect(stripOptionLabel("2) Photosynthesis")).toBe("Photosynthesis");
    expect(stripOptionLabel("(a) Mitochondria")).toBe("Mitochondria");
    expect(stripOptionLabel("- Bullet answer")).toBe("Bullet answer");
  });

  it("leaves genuine answers without a delimiter untouched", () => {
    expect(stripOptionLabel("A vacuum")).toBe("A vacuum"); // no dot after "A"
    expect(stripOptionLabel("1984")).toBe("1984"); // no delimiter
  });
});

describe("grade math — teacher override supersedes AI/auto mark", () => {
  const qg = (o: Record<string, unknown>) => o as never;
  it("uses the override awarded when present, else the auto awarded", () => {
    expect(gradeEffectiveMark(qg({ awarded: 1, max: 2 }))).toBe(1);
    expect(gradeEffectiveMark(qg({ awarded: 1, max: 2, teacher_override: { awarded: 2 } }))).toBe(2);
  });

  it("gradeEffectiveTotal sums per-question effective marks plus whole-paper mark", () => {
    const grade = {
      per_question_json: {
        q1: { awarded: 1, max: 2 },
        q2: { awarded: 0, max: 3, teacher_override: { awarded: 3 } },
      },
      whole_paper_grade: { awarded: 5, max: 10 },
    } as never;
    expect(gradeEffectiveTotal(grade)).toBe(1 + 3 + 5);
    expect(gradeMaxTotal(grade)).toBe(2 + 3 + 10);
  });

  it("handles a grade with no whole-paper component", () => {
    const grade = { per_question_json: { q1: { awarded: 2, max: 2 } }, whole_paper_grade: null } as never;
    expect(gradeEffectiveTotal(grade)).toBe(2);
    expect(gradeMaxTotal(grade)).toBe(2);
  });
});

describe("hasPendingManualGrade — flags photo/PDF answers awaiting a human", () => {
  it("flags an un-overridden manual question sitting at 0", () => {
    const grade = { per_question_json: { q1: { awarded: 0, max: 5, graded_by: "manual" } }, whole_paper_grade: null } as never;
    expect(hasPendingManualGrade(grade)).toBe(true);
  });

  it("does NOT flag an AI-graded 0 (that is a real mark, not pending)", () => {
    const grade = { per_question_json: { q1: { awarded: 0, max: 5, graded_by: "ai" } }, whole_paper_grade: null } as never;
    expect(hasPendingManualGrade(grade)).toBe(false);
  });

  it("flags a whole-paper PDF answer still at 0", () => {
    const grade = { per_question_json: {}, whole_paper_grade: { awarded: 0, max: 10 } } as never;
    expect(hasPendingManualGrade(grade)).toBe(true);
  });
});

describe("homeworkStage — the student-visible stage (RLS-aware)", () => {
  const paper = (status: string) => ({ status }) as never;

  it("is 'graded' only once the teacher has published the grade", () => {
    // Grading has run (status 'graded') but not published -> student still sees 'submitted'.
    expect(homeworkStage(paper("graded"), { submitted_at: "x" } as never, { published_at: null } as never)).toBe("submitted");
    // Published -> graded.
    expect(homeworkStage(paper("graded"), { submitted_at: "x" } as never, { published_at: "2026-07-21" } as never)).toBe("graded");
  });

  it("is 'submitted' when the paper/submission is submitted but ungraded", () => {
    expect(homeworkStage(paper("submitted"), { submitted_at: "x" } as never)).toBe("submitted");
  });

  it("is 'in_progress' when a submission exists but is not submitted", () => {
    expect(homeworkStage(paper("published"), { submitted_at: null } as never)).toBe("in_progress");
  });

  it("is 'to_do' when there is no submission at all", () => {
    expect(homeworkStage(paper("published"), null)).toBe("to_do");
  });
});
