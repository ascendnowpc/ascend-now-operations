import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { GeneratedPaper, Submission, Grade } from "../types/database";
import { homeworkStage, type HomeworkStage } from "../utils/homeworkGrading";

export interface StudentHomeworkItem {
  paper: GeneratedPaper;
  submission: Submission | null;
  grade: Grade | null;
  stage: HomeworkStage;
}

// The student's own published homework papers (RLS already hides drafts), joined
// with their submission and grade so the "My Homework" list can group by stage.
export function useStudentHomework(studentId: string | undefined) {
  const [items, setItems] = useState<StudentHomeworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!studentId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: papers, error: papersError } = await supabase
      .from("generated_papers")
      .select("*")
      .eq("student_id", studentId)
      .neq("status", "draft")
      .order("published_at", { ascending: false, nullsFirst: false });
    if (papersError) {
      setError(papersError.message);
      setLoading(false);
      return;
    }

    const { data: subs, error: subsError } = await supabase
      .from("submissions")
      .select("*")
      .eq("student_id", studentId);
    if (subsError) {
      setError(subsError.message);
      setLoading(false);
      return;
    }

    const subList = (subs as Submission[]) ?? [];
    const subIds = subList.map((s) => s.id);
    let grades: Grade[] = [];
    if (subIds.length > 0) {
      const { data: gradeRows, error: gradesError } = await supabase
        .from("grades")
        .select("*")
        .in("submission_id", subIds);
      if (gradesError) {
        setError(gradesError.message);
        setLoading(false);
        return;
      }
      grades = (gradeRows as Grade[]) ?? [];
    }

    const subByPaper = new Map(subList.map((s) => [s.paper_id, s]));
    const gradeBySub = new Map(grades.map((g) => [g.submission_id, g]));

    setItems(
      ((papers as GeneratedPaper[]) ?? []).map((paper) => {
        const submission = subByPaper.get(paper.id) ?? null;
        const grade = submission ? (gradeBySub.get(submission.id) ?? null) : null;
        return { paper, submission, grade, stage: homeworkStage(paper, submission, grade) };
      }),
    );
    setError(null);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { items, loading, error, refetch };
}
