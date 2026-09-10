import type { HomeworkStage } from "./homeworkGrading";

// "Homework assigned and not done" for the parent dashboard.
//
// The student's own My Homework page groups papers by stage; a parent asks a
// blunter question — what has been set that hasn't been handed in? These
// helpers answer exactly that, off the same four stages, so the two views can
// never disagree about what counts as outstanding.

// Assigned but not handed in. `in_progress` counts as outstanding: the student
// has opened the paper and saved some answers, but nothing has reached the
// teacher, so from a parent's point of view it is still not done.
const OUTSTANDING_STAGES: HomeworkStage[] = ["to_do", "in_progress"];

export function isOutstanding(stage: HomeworkStage): boolean {
  return OUTSTANDING_STAGES.includes(stage);
}

export interface HomeworkTally {
  /** Every published paper assigned to this student. */
  assigned: number;
  /** Assigned but not handed in — the number a parent is actually looking for. */
  outstanding: number;
  /** Handed in, whether or not the teacher has published a mark yet. */
  submitted: number;
  /** Handed in and marked, with the mark released to the student. */
  graded: number;
}

/**
 * Counts a child's homework by what has happened to it.
 *
 * `submitted` deliberately includes graded papers — it means "reached the
 * teacher", not "reached the teacher and stopped there" — so assigned always
 * equals outstanding + submitted, and the three numbers can be read together
 * without arithmetic that doesn't add up.
 */
export function homeworkTally(items: { stage: HomeworkStage }[]): HomeworkTally {
  const tally: HomeworkTally = { assigned: 0, outstanding: 0, submitted: 0, graded: 0 };
  for (const { stage } of items) {
    tally.assigned += 1;
    if (isOutstanding(stage)) {
      tally.outstanding += 1;
    } else {
      tally.submitted += 1;
      if (stage === "graded") tally.graded += 1;
    }
  }
  return tally;
}
