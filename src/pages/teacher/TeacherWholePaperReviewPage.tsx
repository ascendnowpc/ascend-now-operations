import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Toast } from "../../components/ui/Toast";
import { AnnotatableMedia } from "../../components/homework/AnnotatableMedia";
import { useGeneratedPaper } from "../../hooks/useGeneratedPaper";
import { useSubmissionGrade } from "../../hooks/useSubmissionGrade";
import { useAuth } from "../../context/AuthContext";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { resolveWholePaperImages } from "../../utils/homeworkAnswerMedia";
import { wholePaperAnswerFiles, type Annotation } from "../../types/database";

// Dedicated full-page review of the whole-paper PDF a student attached instead
// of answering the subjective questions individually. Reached from the "View &
// annotate PDF" button on the Student's Answers tab (TeacherPaperResults) — the
// PDF is NOT shown inline there anymore; the teacher opens it here, reads the
// pages, drops comment pins anywhere on them, and enters the mark. Publishing
// the grade to the student happens back on the paper's Student's Answers tab
// (TeacherPaperResults), not here — see the "Deliberately no Publish button
// here" note below. Never AI-graded.
export default function TeacherWholePaperReviewPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const id = paperId ? Number(paperId) : undefined;

  const { profile } = useAuth();
  const { teacher } = useMyTeacherProfile();
  const { paper, loading: paperLoading } = useGeneratedPaper(id);
  const {
    submission,
    grade,
    loading,
    setWholePaperMark,
    saveWholePaperAnnotations,
    regrade,
  } = useSubmissionGrade(id);

  // A PC reaching ANOTHER teacher's paper gets a read-only view (mirrors
  // TeacherPaperResults). But a coach who created this paper themselves is
  // acting as its teacher and must still be able to grade/comment on it — so
  // read-only applies only when the viewer is a coach AND not the owner.
  const isCoach = profile?.role === "performance_coach" || teacher?.is_performance_coach === true;
  const isOwningTeacher =
    paper?.created_by_teacher_id != null && teacher?.id === paper.created_by_teacher_id;
  const readOnly = isCoach && !isOwningTeacher;

  const [images, setImages] = useState<string[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [editingMark, setEditingMark] = useState(false);
  const [awardedInput, setAwardedInput] = useState(0);
  const [maxInput, setMaxInput] = useState(0);
  const [savingMark, setSavingMark] = useState(false);
  const [grading, setGrading] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(
    null,
  );

  const wholePaperAnswer = submission?.whole_paper_answer ?? null;
  const wholePaperGrade = grade?.whole_paper_grade ?? null;
  const answerFiles = wholePaperAnswerFiles(wholePaperAnswer);
  const answerFilesKey = answerFiles.map((f) => f.file_url).join(",");
  const answerLabel =
    answerFiles.length === 0
      ? ""
      : answerFiles.length === 1
        ? answerFiles[0].file_name
        : `${answerFiles[0].file_name} +${answerFiles.length - 1} more`;

  useEffect(() => {
    let cancelled = false;
    // The images block only renders once wholePaperGrade exists (which implies
    // an attached file), so there's nothing to load until then — leave
    // imagesLoading true and set state only from the async result.
    if (!wholePaperAnswer) return;
    resolveWholePaperImages(wholePaperAnswer).then((urls) => {
      if (!cancelled) {
        setImages(urls);
        setImagesLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerFilesKey]);

  async function handleSaveMark() {
    if (!teacher) {
      setToast({ message: "Your teacher profile isn't loaded.", variant: "error" });
      return;
    }
    setSavingMark(true);
    const { error } = await setWholePaperMark(awardedInput, maxInput, teacher.id);
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
    const { error } = await saveWholePaperAnnotations(next);
    if (error) setToast({ message: `Could not save comment: ${error}`, variant: "error" });
  }

  const backLink = `/teacher/homework/${paperId}`;

  return (
    <TeacherLayout>
      <div className="mb-3">
        <Link to={backLink} className="text-sm text-navy-400 hover:text-navy-600">
          ← Back to the paper
        </Link>
      </div>

      {loading || paperLoading ? (
        <Spinner />
      ) : !submission || !wholePaperAnswer ? (
        <Card className="p-6">
          <p className="text-sm text-navy-500">
            This submission has no whole-paper answer to review.
          </p>
        </Card>
      ) : !grade || !wholePaperGrade ? (
        <>
          <PageHeader
            title={paper ? `Homework for ${paper.student_id} — worked solution` : "Worked solution"}
            description={answerLabel}
          />
          <Card className="p-6 flex flex-col items-start gap-3">
            <p className="text-sm text-navy-500">
              This worked solution hasn't been prepared for marking yet. Click{" "}
              <span className="font-semibold">Grade now</span> to open it for hand-marking — then
              you can enter the mark and drop comments on the pages.
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
          <PageHeader
            title={paper ? `Homework for ${paper.student_id} — worked solution` : "Worked solution"}
            description={answerLabel}
          />

          <Card className="mb-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-navy-700">Mark for the whole paper</p>
                <p className="text-xs text-navy-400">
                  Covers every written/structured question at once. Never auto-graded — enter the
                  mark by hand.
                </p>
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
                    wholePaperGrade.awarded >= wholePaperGrade.max
                      ? "bg-lime-100 text-lime-700"
                      : wholePaperGrade.awarded > 0
                        ? "bg-amber-100 text-amber-700"
                        : "bg-red-50 text-red-600"
                  }`}
                >
                  {wholePaperGrade.awarded} / {wholePaperGrade.max}
                </span>
                {!readOnly && !editingMark && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setAwardedInput(wholePaperGrade.awarded);
                      setMaxInput(wholePaperGrade.max);
                      setEditingMark(true);
                    }}
                  >
                    {wholePaperGrade.awarded > 0 ? "Change mark" : "Enter mark by hand"}
                  </Button>
                )}
              </div>
            </div>

            {editingMark && (
              <div className="mt-3 flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  value={awardedInput}
                  onChange={(e) => setAwardedInput(Math.max(0, Number(e.target.value)))}
                  className="w-16 rounded-lg border border-navy-100 px-2 py-1 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                <span className="text-xs text-navy-400">/</span>
                <input
                  type="number"
                  min={0}
                  value={maxInput}
                  onChange={(e) => setMaxInput(Math.max(0, Number(e.target.value)))}
                  className="w-16 rounded-lg border border-navy-100 px-2 py-1 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                <Button size="xs" disabled={savingMark} onClick={handleSaveMark}>
                  {savingMark ? "Saving…" : "Save"}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setEditingMark(false)}>
                  Cancel
                </Button>
              </div>
            )}

            {/* Deliberately no Publish button here: publishing is a whole-
                submission action, and this page only covers one attachment.
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
              <Spinner size={16} /> Loading the worked solution…
            </Card>
          ) : images.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-red-600">
                Couldn't load the worked solution. It may still be uploading, or the files could not
                be read.
              </p>
            </Card>
          ) : (
            <AnnotatableMedia
              images={images}
              annotations={wholePaperGrade.annotations}
              editable={!readOnly}
              onChange={!readOnly ? handleSaveAnnotations : undefined}
              indexKey="page"
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
