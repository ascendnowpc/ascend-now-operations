import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { invokeEdgeFunction } from "../lib/edgeFunctions";
import type { Submission, Grade, Annotation, WholePaperGrade } from "../types/database";
import { gradeEffectiveMark } from "../utils/homeworkGrading";

// Loads a paper's submission + grade for the teacher results view, and applies
// per-question overrides. A paper owner (or admin/PC) has ALL on `grades` under
// RLS, so overrides are a plain client UPDATE — no edge function needed.
export function useSubmissionGrade(paperId: number | undefined) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!paperId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: sub, error: subError } = await supabase
      .from("submissions")
      .select("*")
      .eq("paper_id", paperId)
      .maybeSingle();
    if (subError) {
      setError(subError.message);
      setLoading(false);
      return;
    }
    setSubmission((sub as Submission) ?? null);

    if (sub) {
      const { data: gradeRow } = await supabase
        .from("grades")
        .select("*")
        .eq("submission_id", (sub as Submission).id)
        .maybeSingle();
      setGrade((gradeRow as Grade) ?? null);
    } else {
      setGrade(null);
    }
    setError(null);
    setLoading(false);
  }, [paperId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Sets (or clears, when awarded is null) a teacher override on one question,
  // recomputes the effective total, and stamps the review fields.
  async function overrideMark(
    questionId: string,
    awarded: number | null,
    teacherId: string,
  ): Promise<{ error: string | null }> {
    if (!grade) return { error: "No grade loaded." };
    const q = grade.per_question_json[questionId];
    if (!q) return { error: "Unknown question." };

    const per = {
      ...grade.per_question_json,
      [questionId]: {
        ...q,
        teacher_override:
          awarded == null
            ? null
            : {
                awarded: Math.max(0, Math.min(q.max, awarded)),
                marked_by: teacherId,
                marked_at: new Date().toISOString(),
              },
      },
    };
    const total =
      Object.values(per).reduce((s, g) => s + gradeEffectiveMark(g), 0) +
      (grade.whole_paper_grade?.awarded ?? 0);
    const { data, error } = await supabase
      .from("grades")
      .update({
        per_question_json: per,
        total_marks: total,
        teacher_reviewed_by: teacherId,
        teacher_reviewed_at: new Date().toISOString(),
      })
      .eq("id", grade.id)
      .select()
      .single();
    if (error) return { error: error.message };
    setGrade(data as Grade);
    return { error: null };
  }

  // Replaces one question's comment pins (a photo answer's teacher
  // annotations) — no mark change, so review/reviewed_at aren't touched.
  async function saveAnnotations(
    questionId: string,
    annotations: Annotation[],
  ): Promise<{ error: string | null }> {
    if (!grade) return { error: "No grade loaded." };
    const q = grade.per_question_json[questionId];
    if (!q) return { error: "Unknown question." };
    const per = { ...grade.per_question_json, [questionId]: { ...q, annotations } };
    const { data, error } = await supabase
      .from("grades")
      .update({ per_question_json: per })
      .eq("id", grade.id)
      .select()
      .single();
    if (error) return { error: error.message };
    setGrade(data as Grade);
    return { error: null };
  }

  // Sets the teacher's hand-entered mark for the whole-paper PDF answer (see
  // WholePaperGrade) — never AI-graded, so this IS the mark, not an override
  // of one. `max` defaults to whatever grade-homework-submission computed
  // (the paper's subjective-question total) but the teacher may adjust it.
  async function setWholePaperMark(
    awarded: number,
    max: number,
    teacherId: string,
  ): Promise<{ error: string | null }> {
    if (!grade?.whole_paper_grade) return { error: "No whole-paper answer to grade." };
    const wholePaperGrade: WholePaperGrade = {
      ...grade.whole_paper_grade,
      awarded: Math.max(0, Math.min(max, awarded)),
      max,
    };
    const total =
      Object.values(grade.per_question_json).reduce((s, g) => s + gradeEffectiveMark(g), 0) +
      wholePaperGrade.awarded;
    const { data, error } = await supabase
      .from("grades")
      .update({
        whole_paper_grade: wholePaperGrade,
        total_marks: total,
        teacher_reviewed_by: teacherId,
        teacher_reviewed_at: new Date().toISOString(),
      })
      .eq("id", grade.id)
      .select()
      .single();
    if (error) return { error: error.message };
    setGrade(data as Grade);
    return { error: null };
  }

  // Replaces the whole-paper PDF answer's comment pins — no mark change.
  async function saveWholePaperAnnotations(annotations: Annotation[]): Promise<{ error: string | null }> {
    if (!grade?.whole_paper_grade) return { error: "No whole-paper answer to annotate." };
    const { data, error } = await supabase
      .from("grades")
      .update({ whole_paper_grade: { ...grade.whole_paper_grade, annotations } })
      .eq("id", grade.id)
      .select()
      .single();
    if (error) return { error: error.message };
    setGrade(data as Grade);
    return { error: null };
  }

  // Re-runs the grading edge function (e.g. after Gemini was unavailable on the
  // first pass). This overwrites AI/auto marks and clears prior overrides.
  async function regrade(): Promise<{ error: string | null }> {
    if (!submission) return { error: "No submission to grade." };
    const { error } = await invokeEdgeFunction("grade-homework-submission", {
      body: { submission_id: submission.id },
    });
    await refetch();
    return { error: error ? error.message : null };
  }

  // The quality-control gate for grades, mirroring useGeneratedPaper.publish():
  // AI/auto grading writes `grades` as soon as the student submits, but a
  // student can't SELECT the row at all under RLS until published_at is set
  // here. Clicking publish also counts as the teacher's review, so it stamps
  // teacher_reviewed_* too if that hasn't happened via an override already.
  async function publishGrade(teacherId: string): Promise<{ error: string | null }> {
    if (!grade) return { error: "No grade loaded." };
    const { data, error } = await supabase
      .from("grades")
      .update({
        published_at: new Date().toISOString(),
        published_by_teacher_id: teacherId,
        teacher_reviewed_by: grade.teacher_reviewed_by ?? teacherId,
        teacher_reviewed_at: grade.teacher_reviewed_at ?? new Date().toISOString(),
      })
      .eq("id", grade.id)
      .select()
      .single();
    if (error) return { error: error.message };
    setGrade(data as Grade);
    // Fire-and-forget — mirrors notify-homework-published/-submitted: the
    // publish itself already succeeded, so a failed/slow email shouldn't
    // block or fail the teacher's action.
    supabase.functions
      .invoke("notify-homework-grade-published", { body: { grade_id: (data as Grade).id } })
      .catch(() => {});
    return { error: null };
  }

  return {
    submission,
    grade,
    loading,
    error,
    refetch,
    overrideMark,
    saveAnnotations,
    setWholePaperMark,
    saveWholePaperAnnotations,
    regrade,
    publishGrade,
  };
}
