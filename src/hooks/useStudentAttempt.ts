import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { invokeEdgeFunction } from "../lib/edgeFunctions";
import type { GeneratedPaper, Submission, Grade, AnswersMap } from "../types/database";

type WholePaperAnswer = Submission["whole_paper_answer"];

// Loads one homework paper for a student to attempt, plus their submission and
// (once graded) grade. Writes go only to `submissions` — the student owns that
// row under RLS; grading and the paper's status transition are the Phase 7 edge
// function's job (service role), which the student invokes on submit.
export function useStudentAttempt(paperId: number | undefined, studentId: string | undefined) {
  const [paper, setPaper] = useState<GeneratedPaper | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!paperId || !studentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: paperRow, error: paperError } = await supabase
      .from("generated_papers")
      .select("*")
      .eq("id", paperId)
      .maybeSingle();
    if (paperError) {
      setError(paperError.message);
      setLoading(false);
      return;
    }
    setPaper((paperRow as GeneratedPaper) ?? null);

    const { data: subRow } = await supabase
      .from("submissions")
      .select("*")
      .eq("paper_id", paperId)
      .eq("student_id", studentId)
      .maybeSingle();
    const sub = (subRow as Submission) ?? null;
    setSubmission(sub);

    if (sub) {
      const { data: gradeRow } = await supabase
        .from("grades")
        .select("*")
        .eq("submission_id", sub.id)
        .maybeSingle();
      setGrade((gradeRow as Grade) ?? null);
    } else {
      setGrade(null);
    }
    setError(null);
    setLoading(false);
  }, [paperId, studentId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Upserts the student's answers. The submission row is created lazily on the
  // first save (not on view) so an opened-but-untouched paper leaves no row.
  // wholePaperAnswer is passed through unchanged when omitted (undefined),
  // rather than clobbering it back to null, so a plain answers-only save
  // doesn't erase an already-attached whole-paper PDF.
  async function saveAnswers(
    answers: AnswersMap,
    wholePaperAnswer?: WholePaperAnswer,
  ): Promise<{ error: string | null }> {
    if (!paperId || !studentId) return { error: "Not ready." };
    if (submission?.submitted_at) return { error: "Already submitted." };
    const { data, error } = await supabase
      .from("submissions")
      .upsert(
        {
          paper_id: paperId,
          student_id: studentId,
          answers_json: answers,
          ...(wholePaperAnswer !== undefined ? { whole_paper_answer: wholePaperAnswer } : {}),
        },
        { onConflict: "paper_id" },
      )
      .select()
      .single();
    if (error) return { error: error.message };
    setSubmission(data as Submission);
    return { error: null };
  }

  // Final save + lock (sets submitted_at, which the DB trigger makes immutable
  // afterwards), then invokes grading. Grading writes the grade row and flips
  // the paper to 'graded' with service-role rights the student doesn't have.
  async function submit(
    answers: AnswersMap,
    wholePaperAnswer?: WholePaperAnswer,
  ): Promise<{ error: string | null }> {
    if (!paperId || !studentId) return { error: "Not ready." };
    if (submission?.submitted_at) return { error: "Already submitted." };
    const { data, error } = await supabase
      .from("submissions")
      .upsert(
        {
          paper_id: paperId,
          student_id: studentId,
          answers_json: answers,
          ...(wholePaperAnswer !== undefined ? { whole_paper_answer: wholePaperAnswer } : {}),
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "paper_id" },
      )
      .select()
      .single();
    if (error) return { error: error.message };
    setSubmission(data as Submission);

    // Fire-and-forget — mirrors notify-homework-published: the submission
    // itself already succeeded, so a failed/slow email shouldn't block or
    // fail the student's submit action. Sent regardless of grading outcome,
    // since "the teacher needs to know a submission is waiting" holds either way.
    supabase.functions
      .invoke("notify-homework-submitted", { body: { submission_id: (data as Submission).id } })
      .catch(() => {});

    const { error: gradeError } = await invokeEdgeFunction("grade-homework-submission", {
      body: { submission_id: (data as Submission).id },
    });
    // Even if grading errors, the answers are safely submitted; surface the
    // grading failure but let the teacher re-grade later.
    await refetch();
    return { error: gradeError ? gradeError.message : null };
  }

  return { paper, submission, grade, loading, error, refetch, saveAnswers, submit };
}
