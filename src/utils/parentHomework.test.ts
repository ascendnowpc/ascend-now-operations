import { describe, it, expect } from "vitest";
import { isOutstanding, homeworkTally } from "./parentHomework";

describe("isOutstanding — what counts as 'assigned and not done'", () => {
  it("a paper never opened is outstanding", () => {
    expect(isOutstanding("to_do")).toBe(true);
  });

  it("a started-but-unsubmitted paper is still outstanding", () => {
    // The student has saved answers, but nothing has reached the teacher — from
    // a parent's point of view that is not done.
    expect(isOutstanding("in_progress")).toBe(true);
  });

  it("handed in is not outstanding, marked or not", () => {
    expect(isOutstanding("submitted")).toBe(false);
    expect(isOutstanding("graded")).toBe(false);
  });
});

describe("homeworkTally", () => {
  it("counts each stage into the right bucket", () => {
    const tally = homeworkTally([
      { stage: "to_do" },
      { stage: "in_progress" },
      { stage: "submitted" },
      { stage: "graded" },
    ]);
    expect(tally).toEqual({ assigned: 4, outstanding: 2, submitted: 2, graded: 1 });
  });

  it("counts a graded paper as submitted too, so assigned = outstanding + submitted", () => {
    const tally = homeworkTally([{ stage: "graded" }, { stage: "graded" }, { stage: "to_do" }]);
    expect(tally.submitted).toBe(2);
    expect(tally.outstanding + tally.submitted).toBe(tally.assigned);
  });

  it("is all zeros for a student with no homework", () => {
    expect(homeworkTally([])).toEqual({ assigned: 0, outstanding: 0, submitted: 0, graded: 0 });
  });

  it("reports zero outstanding once everything has been handed in", () => {
    const tally = homeworkTally([{ stage: "submitted" }, { stage: "graded" }]);
    expect(tally.outstanding).toBe(0);
  });
});
