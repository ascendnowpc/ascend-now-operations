import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Toast } from "../ui/Toast";
import { useSubmissionGrade } from "../../hooks/useSubmissionGrade";
import { useAuth } from "../../context/AuthContext";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import {
  gradeEffectiveMark,
  gradeEffectiveTotal,
  gradeMaxTotal,
  stripOptionLabel,
} from "../../utils/homeworkGrading";
import { QuestionContent, QuestionMarkdown } from "./QuestionContent";
import {
  isPhotoAnswer,
  wholePaperAnswerFiles,
  type GeneratedPaper,
  type GeneratedQuestion,
  type QuestionGrade,
  type HomeworkAnswer,
} from "../../types/database";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

function StudentAnswer({ q, answer }: { q: GeneratedQuestion; answer: HomeworkAnswer }) {
  if (q.question_type === "mcq" || q.question_type === "true_false") {
    const chosen = typeof answer === "number" ? answer : null;
    return (
      <div className="flex flex-wrap items-baseline gap-x-1 text-sm text-navy-700">
        <span className="font-semibold">Answer:</span>
        {chosen == null ? (
          <span className="text-navy-300">no answer</span>
        ) : (
          <QuestionMarkdown
            text={`${LETTERS[chosen] ?? chosen + 1}. ${stripOptionLabel(q.options?.[chosen] ?? "")}`}
            className="text-sm text-navy-700"
          />
        )}
        {typeof q.correct_option === "number" && chosen !== q.correct_option && (
          <span className="text-navy-400">
            (correct: {LETTERS[q.correct_option] ?? q.correct_option + 1})
          </span>
        )}
      </div>
    );
  }
  const text = typeof answer === "string" ? answer : "";
  return (
    <div className="text-sm text-navy-700">
      <span className="font-semibold">Answer:</span>{" "}
      {text ? (
        <span className="whitespace-pre-wrap">{text}</span>
      ) : (
        <span className="text-navy-300">no answer</span>
      )}
    </div>
  );
}

// A subjective question answered with a photo or PDF instead of typed text —
// never AI-graded (see grade-homework-submission). NOT shown inline here (the
// upload needs room + zoom to actually read, same reasoning as the
// whole-paper PDF below) — it opens on its own full-page review route
// (TeacherQuestionPhotoReviewPage) where the teacher comments, marks, and
// publishes. This card is just the entry point, plus the current mark.
function PhotoAnswerReviewLink({
  paperId,
  questionId,
  awarded,
  max,
  commentCount,
}: {
  paperId: number;
  questionId: string;
  awarded: number;
  max: number;
  commentCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-navy-50/60 px-3 py-2.5">
      <p className="text-xs text-navy-500">
        Photo/PDF answer ·{" "}
        {commentCount === 0 ? "no comments yet" : `${commentCount} comment${commentCount === 1 ? "" : "s"}`}
      </p>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${
            awarded >= max ? "bg-lime-100 text-lime-700" : awarded > 0 ? "bg-amber-100 text-amber-700" : "bg-red-50 text-red-600"
          }`}
        >
          {awarded} / {max}
        </span>
        <Link to={`/teacher/homework/${paperId}/question/${questionId}`}>
          <Button size="xs">View &amp; annotate</Button>
        </Link>
      </div>
    </div>
  );
}

// The whole-paper answer (a PDF and/or photos) a student can attach instead of
// answering subjective questions individually is NOT shown inline here — it
// opens on its own full-page review route (TeacherWholePaperReviewPage) where
// the teacher annotates it, enters the mark, and publishes. This card is just
// the entry point to that route, plus the current mark at a glance.
function WholePaperReviewLink({
  paperId,
  label,
  awarded,
  max,
  commentCount,
}: {
  paperId: number;
  label: string;
  awarded: number;
  max: number;
  commentCount: number;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-navy-700">Whole-paper answer — {label}</p>
          <p className="text-xs text-navy-400">
            Covers every written/structured question at once ·{" "}
            {commentCount === 0 ? "no comments yet" : `${commentCount} comment${commentCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${
              awarded >= max
                ? "bg-lime-100 text-lime-700"
                : awarded > 0
                  ? "bg-amber-100 text-amber-700"
                  : "bg-red-50 text-red-600"
            }`}
          >
            {awarded} / {max}
          </span>
          <Link to={`/teacher/homework/${paperId}/whole-paper`}>
            <Button size="sm">View &amp; annotate</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

function OverrideControl({
  qg,
  onSave,
  disabled,
}: {
  qg: QuestionGrade;
  onSave: (awarded: number | null) => Promise<void>;
  disabled: boolean;
}) {
  const isManual = qg.graded_by === "manual";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(gradeEffectiveMark(qg));
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <Button
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={() => {
          setValue(gradeEffectiveMark(qg));
          setEditing(true);
        }}
      >
        {isManual ? (qg.teacher_override ? "Change mark" : "Enter mark") : qg.teacher_override ? "Change mark" : "Override"}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        max={qg.max}
        value={value}
        onChange={(e) => setValue(Math.max(0, Math.min(qg.max, Number(e.target.value))))}
        className="w-16 rounded-lg border border-navy-100 px-2 py-1 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
      />
      <span className="text-xs text-navy-400">/ {qg.max}</span>
      <Button
        size="xs"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          await onSave(value);
          setSaving(false);
          setEditing(false);
        }}
      >
        Save
      </Button>
      {qg.teacher_override && (
        <Button
          variant="ghost"
          size="xs"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(null);
            setSaving(false);
            setEditing(false);
          }}
        >
          {isManual ? "Clear" : "Reset to AI"}
        </Button>
      )}
      <Button variant="ghost" size="xs" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </div>
  );
}

// Teacher-facing results for a submitted/graded paper: the student's answers,
// the auto/AI marks + feedback, and one-click per-question overrides. Shown by
// the review page in place of the draft editor once a paper is submitted.
export function TeacherPaperResults({ paper }: { paper: GeneratedPaper }) {
  const { profile } = useAuth();
  const { teacher } = useMyTeacherProfile();
  // A PC can reach any teacher's paper (the student-detail Homework tab and
  // the Generator page's student lookup both link here for a student who
  // isn't necessarily this PC's own), so grading is kept with the paper's
  // actual teacher — a PC gets this same view read-only for papers they don't
  // own. But a coach who CREATED this paper is acting as its teacher and must
  // still be able to grade it, so read-only applies only to a coach who is not
  // the owner (a plain teacher only ever reaches their own papers anyway).
  const isCoach = profile?.role === "performance_coach" || teacher?.is_performance_coach === true;
  const isOwningTeacher = teacher?.id != null && teacher.id === paper.created_by_teacher_id;
  // An admin only ever views these results (grading stays a teacher/PC action),
  // so they get the same read-only variant as a non-owning coach.
  const readOnly = profile?.role === "admin" || (isCoach && !isOwningTeacher);
  const {
    submission,
    grade,
    loading,
    overrideMark,
    regrade,
    publishGrade,
  } = useSubmissionGrade(paper.id);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(
    null,
  );

  const content = paper.questions_json;
  const answers = submission?.answers_json ?? {};

  if (loading) return <Spinner />;
  if (!submission) {
    return (
      <Card className="p-6">
        <p className="text-sm text-navy-500">No submission from the student yet.</p>
      </Card>
    );
  }
  if (!grade) {
    return (
      <Card className="p-6 flex items-center justify-between gap-3">
        <p className="text-sm text-navy-500">
          Submitted {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString() : ""} — not graded yet.
        </p>
        {!readOnly && (
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const { error } = await regrade();
              setBusy(false);
              setToast(
                error
                  ? { message: `Grading failed: ${error}`, variant: "error" }
                  : { message: "Graded.", variant: "success" },
              );
            }}
          >
            {busy ? "Grading…" : "Grade now"}
          </Button>
        )}
      </Card>
    );
  }

  const total = gradeEffectiveTotal(grade);
  const max = gradeMaxTotal(grade);

  async function handleOverride(qid: string, awarded: number | null) {
    if (!teacher) {
      setToast({ message: "Your teacher profile isn't loaded.", variant: "error" });
      return;
    }
    const { error } = await overrideMark(qid, awarded, teacher.id);
    setToast(
      error
        ? { message: `Could not save override: ${error}`, variant: "error" }
        : { message: "Mark updated.", variant: "success" },
    );
  }

  async function handlePublishGrade() {
    if (!teacher) {
      setToast({ message: "Your teacher profile isn't loaded.", variant: "error" });
      return;
    }
    setPublishing(true);
    const { error } = await publishGrade(teacher.id);
    setPublishing(false);
    setToast(
      error
        ? { message: `Could not publish grade: ${error}`, variant: "error" }
        : { message: "Grade published — the student can now see their marks.", variant: "success" },
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="rounded-xl border border-lime-200 bg-lime-50 px-4 py-2.5 text-sm text-navy-700">
          <span className="font-semibold">
            Score: {total} / {max}
          </span>
          {grade.teacher_reviewed_at
            ? ` · reviewed ${new Date(grade.teacher_reviewed_at).toLocaleDateString()}`
            : " · not yet teacher-reviewed"}
          {grade.published_at ? (
            <span className="ml-2 rounded-pill bg-lime-200 px-2 py-0.5 text-xs font-semibold text-navy-700">
              Visible to student since {new Date(grade.published_at).toLocaleDateString()}
            </span>
          ) : (
            <span className="ml-2 rounded-pill bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              Not yet visible to student
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || publishing}
              onClick={async () => {
                setBusy(true);
                const { error } = await regrade();
                setBusy(false);
                setToast(
                  error
                    ? { message: `Re-grade failed: ${error}`, variant: "error" }
                    : { message: "Re-graded (overrides and publish state cleared).", variant: "success" },
                );
              }}
            >
              {busy ? "Re-grading…" : "Re-grade with AI"}
            </Button>
            <Button size="sm" disabled={busy || publishing} onClick={handlePublishGrade}>
              {publishing ? "Publishing…" : grade.published_at ? "Re-publish grade" : "Publish grade to student"}
            </Button>
          </div>
        )}
      </div>

      {submission.whole_paper_answer && grade.whole_paper_grade && (
        <div className="mb-5">
          {(() => {
            const files = wholePaperAnswerFiles(submission.whole_paper_answer);
            const label =
              files.length <= 1
                ? (files[0]?.file_name ?? "attachment")
                : `${files[0].file_name} +${files.length - 1} more`;
            return (
              <WholePaperReviewLink
                paperId={paper.id}
                label={label}
                awarded={grade.whole_paper_grade.awarded}
                max={grade.whole_paper_grade.max}
                commentCount={grade.whole_paper_grade.annotations.length}
              />
            );
          })()}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {(content?.questions ?? []).map((q, i) => {
          const qg = grade.per_question_json[q.id];
          const answer = answers[q.id] ?? null;
          const photoAnswer = isPhotoAnswer(answer) ? answer : null;
          return (
            <Card key={q.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-navy-400">
                  <span className="rounded-pill bg-navy-50 px-2 py-0.5 text-navy-600">Q{i + 1}</span>
                  <span className="uppercase tracking-wide">
                    {q.question_type.replace("_", " ")}
                  </span>
                </div>
                {qg && (
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${
                        gradeEffectiveMark(qg) >= qg.max
                          ? "bg-lime-100 text-lime-700"
                          : gradeEffectiveMark(qg) > 0
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-50 text-red-600"
                      }`}
                    >
                      {gradeEffectiveMark(qg)} / {qg.max}
                      {qg.teacher_override ? " · teacher" : qg.graded_by === "ai" ? " · AI" : qg.graded_by === "manual" ? " · teacher-marked" : ""}
                    </span>
                    {/* A photo answer's mark is entered on its own review
                        page (TeacherQuestionPhotoReviewPage), not here. */}
                    {!readOnly && !photoAnswer && (
                      <OverrideControl qg={qg} onSave={(v) => handleOverride(q.id, v)} disabled={busy} />
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3">
                <QuestionContent prompt={q.prompt} figures={q.figures} />
              </div>

              <div className="mt-3">
                {photoAnswer ? (
                  <PhotoAnswerReviewLink
                    paperId={paper.id}
                    questionId={q.id}
                    awarded={qg ? gradeEffectiveMark(qg) : 0}
                    max={qg?.max ?? q.marks}
                    commentCount={qg?.annotations?.length ?? 0}
                  />
                ) : (
                  <StudentAnswer q={q} answer={answer} />
                )}
              </div>

              {qg?.feedback && !photoAnswer && (
                <div className="mt-3 rounded-lg bg-navy-50/60 px-3 py-2">
                  <QuestionMarkdown text={qg.feedback} className="text-sm text-navy-600" />
                </div>
              )}
              {qg?.per_point && qg.per_point.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {qg.per_point.map((p, j) => (
                    <li key={j} className="flex items-start gap-2 text-xs text-navy-500">
                      <span className={p.awarded > 0 ? "text-lime-600" : "text-red-500"}>
                        {p.awarded > 0 ? "✓" : "✗"}
                      </span>
                      <QuestionMarkdown text={p.point} className="flex-1 text-xs text-navy-500" />
                      <span className="shrink-0">
                        {p.awarded}/{p.max}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {toast && (
        <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </>
  );
}
