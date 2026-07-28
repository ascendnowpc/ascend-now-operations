import type { QuestionGrade, GeneratedPaper, Submission, Grade } from "../types/database";

// Strips a leading enumerator ("1. ", "2) ", "A. ", "(a) ", "- ") that the
// generator or a parsed paper sometimes bakes into an MCQ option, so it doesn't
// render as a duplicated label next to the UI's own A/B/C/D. Requires a
// delimiter after the token, so a genuine answer like "A vacuum" (no dot) or
// "1984" (no delimiter) is untouched. Display-only — grading matches by the
// option index, never the text, so cleaning the text here is always safe.
export function stripOptionLabel(s: string): string {
  return s.replace(/^\s*(?:\(?\d{1,2}[.)\]]|\(?[A-Za-z][.)\]]|[-•*])\s+/, "").trim();
}

// The mark that counts: a teacher override supersedes the auto/AI mark.
export function gradeEffectiveMark(qg: QuestionGrade): number {
  return qg.teacher_override ? qg.teacher_override.awarded : qg.awarded;
}

// Sum of effective marks across all questions PLUS the whole-paper PDF mark
// (if the student attached one instead of answering subjective questions
// individually — see WholePaperGrade), for a live total that reflects any
// overrides/manual marks without waiting for a re-grade to rewrite
// grades.total_marks.
export function gradeEffectiveTotal(grade: Pick<Grade, "per_question_json" | "whole_paper_grade">): number {
  const perQuestion = Object.values(grade.per_question_json).reduce((s, qg) => s + gradeEffectiveMark(qg), 0);
  return perQuestion + (grade.whole_paper_grade?.awarded ?? 0);
}

export function gradeMaxTotal(grade: Pick<Grade, "per_question_json" | "whole_paper_grade">): number {
  const perQuestion = Object.values(grade.per_question_json).reduce((s, qg) => s + qg.max, 0);
  return perQuestion + (grade.whole_paper_grade?.max ?? 0);
}

// A manually-graded (photo) question, or the whole-paper PDF answer, still
// showing its pending placeholder (awarded 0, no teacher entry yet) — used to
// flag "needs your attention" on the review page, since these are never
// AI-graded and won't resolve themselves the way a normal AI grade does.
export function hasPendingManualGrade(grade: Pick<Grade, "per_question_json" | "whole_paper_grade">): boolean {
  const pendingQuestion = Object.values(grade.per_question_json).some(
    (qg) => qg.graded_by === "manual" && qg.awarded === 0 && !qg.teacher_override,
  );
  const pendingWholePaper = !!grade.whole_paper_grade && grade.whole_paper_grade.awarded === 0;
  return pendingQuestion || pendingWholePaper;
}

// What a student/teacher sees as the paper's real state. generated_papers.status
// can't be advanced by the student under RLS, so "in progress" is derived from
// the submission (a started-but-not-submitted row) rather than stored on the
// paper — see HOMEWORK_GENERATOR_ARCHITECTURE.md Phase 6.
//
// "graded" here means "visible to the student as graded" — i.e. the teacher
// has published the grade (grade.published_at set), not merely that AI/auto
// grading has run. generated_papers.status flips to 'graded' as soon as
// grading finishes, before any teacher review, so that alone is deliberately
// NOT enough to reach this stage (a paper that's graded-but-unpublished still
// reads as "submitted" to the student, matching what they can actually see —
// RLS blocks the grade row entirely until it's published).
export type HomeworkStage = "to_do" | "in_progress" | "submitted" | "graded";

export function homeworkStage(
  paper: Pick<GeneratedPaper, "status">,
  submission: Pick<Submission, "submitted_at"> | null,
  grade?: Pick<Grade, "published_at"> | null,
): HomeworkStage {
  if (grade?.published_at) return "graded";
  if (paper.status === "submitted" || paper.status === "graded" || submission?.submitted_at) {
    return "submitted";
  }
  if (submission) return "in_progress";
  return "to_do";
}

export const STAGE_LABEL: Record<HomeworkStage, string> = {
  to_do: "To do",
  in_progress: "In progress",
  submitted: "Submitted",
  graded: "Graded",
};

export const STAGE_BADGE: Record<HomeworkStage, string> = {
  to_do: "bg-sky-100 text-sky-700",
  in_progress: "bg-amber-100 text-amber-700",
  submitted: "bg-indigo-100 text-indigo-700",
  graded: "bg-lime-200 text-navy-700",
};

export const STAGE_ORDER: HomeworkStage[] = ["to_do", "in_progress", "submitted", "graded"];

// The stage a TEACHER sees for their own paper. Unlike homeworkStage (the
// student's view), this distinguishes "needs the teacher's review" from
// "graded". `generated_papers.status` flips to 'graded' the instant AI/auto
// grading finishes on submit — before the teacher has looked at anything — so
// showing "graded" there was misleading: it reads as "done" when the teacher
// still has to review and publish. This reports "needs_review" for any
// submitted paper whose grade the teacher hasn't published yet, and only
// "graded" once grade.published_at is set (the teacher's explicit publish).
export type TeacherPaperStage =
  | "draft"
  | "published"
  | "in_progress"
  | "needs_review"
  | "graded";

export function teacherPaperStage(
  paper: Pick<GeneratedPaper, "status">,
  submission: Pick<Submission, "submitted_at"> | null | undefined,
  grade: Pick<Grade, "published_at"> | null | undefined,
): TeacherPaperStage {
  if (paper.status === "draft") return "draft";
  if (grade?.published_at) return "graded";
  if (paper.status === "submitted" || paper.status === "graded" || submission?.submitted_at) {
    return "needs_review";
  }
  if (submission) return "in_progress";
  return "published";
}

export const TEACHER_STAGE_LABEL: Record<TeacherPaperStage, string> = {
  draft: "Draft",
  published: "Published",
  in_progress: "In progress",
  needs_review: "Needs review",
  graded: "Graded",
};

export const TEACHER_STAGE_BADGE: Record<TeacherPaperStage, string> = {
  draft: "bg-navy-50 text-navy-500",
  published: "bg-sky-100 text-sky-700",
  in_progress: "bg-amber-100 text-amber-700",
  needs_review: "bg-orange-100 text-orange-700",
  graded: "bg-lime-200 text-navy-700",
};

// Numbers a set of papers "Homework #1", "#2", … per student, in CREATION
// order (created_at). Creation order is used deliberately — and NOT the old
// "published papers first, by published_at, drafts appended after" scheme —
// because created_at is immutable, so a paper keeps the SAME "Homework N" for
// its whole life. The old scheme renumbered a paper the moment it was
// published (a draft numbered #6 among several drafts jumped to #4 when it
// moved out of the drafts-at-the-end bucket into the smaller published range),
// which is exactly what we don't want: a homework's number must not change
// under the teacher/student when its status advances.
//
// Scoped per student (not globally) because each paper belongs to one student
// and "Homework #3" should mean the same paper whether a teacher or that
// student is looking at it. A student never sees drafts (RLS hides them), so
// their list may skip a number that's still a draft on the teacher's side —
// the gap fills in when that draft is published, and a stable number is worth
// far more than a gap-free-but-shifting one.
export function assignHomeworkNumbers(
  papers: Pick<GeneratedPaper, "id" | "student_id" | "status" | "published_at" | "created_at">[],
): Map<number, number> {
  const byStudent = new Map<string, typeof papers>();
  for (const p of papers) {
    const arr = byStudent.get(p.student_id) ?? [];
    arr.push(p);
    byStudent.set(p.student_id, arr);
  }

  const numbers = new Map<number, number>();
  for (const group of byStudent.values()) {
    const sorted = [...group].sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      // Stable tiebreak on id when two papers share a created_at, so the
      // numbering is deterministic rather than dependent on fetch order.
      return diff !== 0 ? diff : a.id - b.id;
    });
    sorted.forEach((p, i) => numbers.set(p.id, i + 1));
  }
  return numbers;
}

// A readable paper title: its subject (so papers can be told apart at a
// glance) plus its per-student "Homework N" serial (from assignHomeworkNumbers)
// — e.g. "Maths · Homework 2". Falls back to a bare "Homework N" when the
// paper has no subject. Shared by every homework list (teacher generator,
// student's own list, and the PC/admin student-detail Homework tab) so the
// same paper always reads the same everywhere.
export function paperDisplayName(
  paper: { subject_id: number | null },
  subjectName: (id: number | null) => string | null,
  number: number | string,
): string {
  const subj = subjectName(paper.subject_id);
  return subj ? `${subj} · Homework ${number}` : `Homework ${number}`;
}
