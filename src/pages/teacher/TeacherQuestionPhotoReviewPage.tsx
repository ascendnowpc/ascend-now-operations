import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Toast } from "../../components/ui/Toast";
import { AnnotatableMedia } from "../../components/homework/AnnotatableMedia";
import { QuestionContent } from "../../components/homework/QuestionContent";
import { useGeneratedPaper } from "../../hooks/useGeneratedPaper";
import { useSubmissionGrade } from "../../hooks/useSubmissionGrade";
import { useAuth } from "../../context/AuthContext";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { gradeEffectiveMark } from "../../utils/homeworkGrading";
import { resolveAnswerImages } from "../../utils/homeworkAnswerMedia";
import { isPhotoAnswer, type Annotation } from "../../types/database";

// Dedicated full-page review of ONE question's photo answer — the same
// pattern as TeacherWholePaperReviewPage for a whole-paper PDF, just scoped
// to a single question instead of the whole submission. Reached from the
// "View & annotate photo" button on the Student's Answers tab
// (TeacherPaperResults) — a photo answer is no longer shown inline there;
// the teacher opens it here, drops comment pins with room to actually see
// the image (margin + zoom, like the PDF page), and enters the mark.
// Publishing the grade happens back on the Student's Answers tab, not here —
// see the "Deliberately no Publish button here" note below. Never AI-graded.
export default function TeacherQuestionPhotoReviewPage() {
  const { paperId, questionId } = useParams<{ paperId: string; questionId: string }>();
  const id = paperId ? Number(paperId) : undefined;

  const { profile } = useAuth();
  const { teacher } = useMyTeacherProfile();
  const { paper, loading: paperLoading } = useGeneratedPaper(id);
  const {
    submission,
    grade,
    loading,
    overrideMark,
    saveAnnotations,
    regrade,
  } = useSubmissionGrade(id);

  // A PC reaching ANOTHER teacher's paper gets a read-only view (mirrors
  // TeacherPaperResults / TeacherWholePaperReviewPage). A coach who created
  // this paper themselves is acting as its teacher and must still be able to
  // grade/comment on it.
  const isCoach = profile?.role === "performance_coach" || teacher?.is_performance_coach === true;
  const isOwningTeacher =
    paper?.created_by_teacher_id != null && teacher?.id === paper.created_by_teacher_id;
  const readOnly = isCoach && !isOwningTeacher;

  const content = paper?.questions_json ?? null;
  const questionIndex = content?.questions.findIndex((q) => q.id === questionId) ?? -1;
  const question = questionIndex >= 0 ? content!.questions[questionIndex] : null;
  const answer = questionId ? (submission?.answers_json?.[questionId] ?? null) : null;
  const photoAnswer = isPhotoAnswer(answer) ? answer : null;
  const qg = questionId ? grade?.per_question_json[questionId] : undefined;

  const [images, setImages] = useState<string[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [editingMark, setEditingMark] = useState(false);
  const [awardedInput, setAwardedInput] = useState(0);
  const [savingMark, setSavingMark] = useState(false);
  const [grading, setGrading] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(
    null,
  );

  const fileUrls = photoAnswer?.files.map((f) => f.file_url).join(",") ?? "";
  useEffect(() => {
    let cancelled = false;
    // The images block only renders once a photo answer exists, so there's
    // nothing to load until then — leave imagesLoading true and set state
    // only from the async result, never synchronously here.
    if (!photoAnswer) return;
    resolveAnswerImages(photoAnswer.files).then((urls) => {
      if (!cancelled) {
        setImages(urls);
        setImagesLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrls]);

  async function handleSaveMark() {
    if (!teacher || !questionId) {
      setToast({ message: "Your teacher profile isn't loaded.", variant: "error" });
      return;
    }
    setSavingMark(true);
    const { error } = await overrideMark(questionId, awardedInput, teacher.id);
    setSavingMark(false);
    if (error) {
      setToast({ message: `Could not save mark: ${error}`, variant: "error" });
    } else {
      setEditingMark(false);
      setToast({ message: "Mark saved.", variant: "success" });
    }
  }

  async function handleGradeNow() {
    setGrading(true);
    const { error } = await regrade();
    setGrading(false);
    if (error) setToast({ message: `Could not prepare grading: ${error}`, variant: "error" });
  }

  async function handleSaveAnnotations(next: Annotation[]) {
    if (!questionId) return;
    const { error } = await saveAnnotations(questionId, next);
    if (error) setToast({ message: `Could not save comment: ${error}`, variant: "error" });
  }

  const backLink = `/teacher/homework/${paperId}`;
  const pageTitle = paper
    ? `Homework for ${paper.student_id} — uploaded answer${questionIndex >= 0 ? ` (Q${questionIndex + 1})` : ""}`
    : "Uploaded answer";

  return (
    <TeacherLayout>
      <div className="mb-3">
        <Link to={backLink} className="text-sm text-navy-400 hover:text-navy-600">
          ← Back to the paper
        </Link>
      </div>

      {loading || paperLoading ? (
        <Spinner />
      ) : !submission || !question || !photoAnswer ? (
        <Card className="p-6">
          <p className="text-sm text-navy-500">This question has no photo/PDF answer to review.</p>
        </Card>
      ) : !grade || !qg ? (
        <>
          <PageHeader title={pageTitle} />
          <Card className="mb-4 p-4">
            <QuestionContent prompt={question.prompt} figures={question.figures} />
          </Card>
          <Card className="p-6 flex flex-col items-start gap-3">
            <p className="text-sm text-navy-500">
              This answer hasn't been prepared for marking yet. Click{" "}
              <span className="font-semibold">Grade now</span> to open it for hand-marking — then
              you can enter the mark and drop comments on it.
            </p>
            {!readOnly ? (
              <Button size="sm" disabled={grading} onClick={handleGradeNow}>
                {grading ? "Preparing…" : "Grade now"}
              </Button>
            ) : (
              <p className="text-xs text-navy-400">
                Only the paper's own teacher can grade this submission.
              </p>
            )}
          </Card>
        </>
      ) : (
        <>
          <PageHeader title={pageTitle} />

          <Card className="mb-4 p-4">
            <QuestionContent prompt={question.prompt} figures={question.figures} />

            <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-navy-50 pt-3">
              <div>
                <p className="text-xs text-navy-400">Never auto-graded — enter the mark by hand.</p>
                {grade.published_at ? (
                  <span className="mt-2 inline-block rounded-pill bg-lime-200 px-2 py-0.5 text-xs font-semibold text-navy-700">
                    Published to student on {new Date(grade.published_at).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="mt-2 inline-block rounded-pill bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    Not yet visible to student
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${
                    gradeEffectiveMark(qg) >= qg.max
                      ? "bg-lime-100 text-lime-700"
                      : gradeEffectiveMark(qg) > 0
                        ? "bg-amber-100 text-amber-700"
                        : "bg-red-50 text-red-600"
                  }`}
                >
                  {gradeEffectiveMark(qg)} / {qg.max}
                </span>
                {!readOnly && !editingMark && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setAwardedInput(gradeEffectiveMark(qg));
                      setEditingMark(true);
                    }}
                  >
                    {qg.teacher_override ? "Change mark" : "Enter mark by hand"}
                  </Button>
                )}
              </div>
            </div>

            {editingMark && (
              <div className="mt-3 flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={qg.max}
                  value={awardedInput}
                  onChange={(e) => setAwardedInput(Math.max(0, Math.min(qg.max, Number(e.target.value))))}
                  className="w-16 rounded-lg border border-navy-100 px-2 py-1 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                <span className="text-xs text-navy-400">/ {qg.max}</span>
                <Button size="xs" disabled={savingMark} onClick={handleSaveMark}>
                  {savingMark ? "Saving…" : "Save"}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setEditingMark(false)}>
                  Cancel
                </Button>
              </div>
            )}

            {/* Deliberately no Publish button here: publishing is a whole-
                submission action, and this page only covers one question.
                Once every question is marked to your satisfaction, publish
                from the paper's Student's Answers tab (the link above). */}
            <div className="mt-4 border-t border-navy-50 pt-3">
              <p className="text-xs text-navy-400">
                Publish this grade from the paper's{" "}
                <Link to={backLink} className="font-semibold text-sky-600 hover:underline">
                  Student's Answers tab
                </Link>{" "}
                once you're done reviewing.
              </p>
            </div>
          </Card>

          {imagesLoading ? (
            <Card className="p-6 flex items-center gap-2 text-navy-400">
              <Spinner size={16} /> Loading the answer…
            </Card>
          ) : images.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-red-600">
                Couldn't load the answer. It may still be uploading, or the file could not be read.
              </p>
            </Card>
          ) : (
            <AnnotatableMedia
              images={images}
              annotations={qg.annotations ?? []}
              editable={!readOnly}
              onChange={!readOnly ? handleSaveAnnotations : undefined}
              indexKey="file_index"
              readingWidthPx={768}
            />
          )}
        </>
      )}

      {toast && (
        <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </TeacherLayout>
  );
}
