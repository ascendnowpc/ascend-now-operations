import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { StudentLayout } from "./StudentLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Toast } from "../../components/ui/Toast";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { QuestionAttemptCard } from "../../components/homework/QuestionAttemptCard";
import { HomeworkExportButtons } from "../../components/homework/HomeworkExportButtons";
import { AnnotatableMedia } from "../../components/homework/AnnotatableMedia";
import { QuestionMarkdown, StimulusContent } from "../../components/homework/QuestionContent";
import { useMyStudent } from "../../hooks/useMyStudent";
import { useStudentAttempt } from "../../hooks/useStudentAttempt";
import { useStyleTemplates } from "../../hooks/useStyleTemplates";
import { gradeEffectiveTotal, gradeMaxTotal } from "../../utils/homeworkGrading";
import { uploadHomeworkAnswerFiles, resolveWholePaperImages } from "../../utils/homeworkAnswerMedia";
import {
  wholePaperAnswerFiles,
  type AnswersMap,
  type HomeworkAnswer,
  type WholePaperAnswer,
} from "../../types/database";

// Whole-paper worked solutions may be a PDF and/or photos.
const WHOLE_PAPER_ACCEPT = "application/pdf,.pdf,image/*";

const SUBJECTIVE_TYPES = new Set([
  "short_answer",
  "structured",
  "extended_response",
  "essay",
  "criterion",
]);

export default function StudentHomeworkAttemptPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const id = paperId ? Number(paperId) : undefined;
  const { student, loading: studentLoading } = useMyStudent();
  const { paper, submission, grade, loading, error, saveAnswers, submit } = useStudentAttempt(
    id,
    student?.id,
  );
  const { templates } = useStyleTemplates();
  const styleName = useMemo(() => {
    const m = new Map(templates.map((t) => [t.code, t.name]));
    return (code: string) => m.get(code) ?? code;
  }, [templates]);

  const [answers, setAnswers] = useState<AnswersMap>({});
  const [wholePaperAnswer, setWholePaperAnswer] = useState<WholePaperAnswer | null>(null);
  const [wholePaperUploading, setWholePaperUploading] = useState(false);
  const [wholePaperError, setWholePaperError] = useState<string | null>(null);
  const [wholePaperImages, setWholePaperImages] = useState<string[]>([]);
  const hydrated = useRef(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(
    null,
  );

  // Seed local answers from the saved submission once, after the first load.
  useEffect(() => {
    if (!loading && !hydrated.current) {
      setAnswers(submission?.answers_json ?? {});
      setWholePaperAnswer(submission?.whole_paper_answer ?? null);
      hydrated.current = true;
    }
  }, [loading, submission]);

  const submitted = !!submission?.submitted_at;
  const content = paper?.questions_json ?? null;

  // Once graded, render the whole-paper answer (read-only, with the teacher's
  // comment pins) instead of just showing the filenames.
  const submittedWholePaper = submission?.whole_paper_answer ?? null;
  const submittedWholePaperKey = wholePaperAnswerFiles(submittedWholePaper)
    .map((f) => f.file_url)
    .join(",");
  useEffect(() => {
    let cancelled = false;
    (grade?.whole_paper_grade && submittedWholePaper
      ? resolveWholePaperImages(submittedWholePaper)
      : Promise.resolve([])
    ).then((urls) => {
      if (!cancelled) setWholePaperImages(urls);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade?.whole_paper_grade, submittedWholePaperKey]);

  // A whole-paper PDF covers every subjective question at once, so those
  // don't need an individual answer — only objective questions (still
  // answered/auto-graded per-question regardless) count toward "unanswered".
  const unanswered = useMemo(() => {
    if (!content) return 0;
    return content.questions.filter((q) => {
      if (wholePaperAnswer && SUBJECTIVE_TYPES.has(q.question_type)) return false;
      const a = answers[q.id];
      return a === undefined || a === null || a === "";
    }).length;
  }, [content, answers, wholePaperAnswer]);

  const hasSubjective = !!content?.questions.some((q) => SUBJECTIVE_TYPES.has(q.question_type));

  // Group questions by their composition block so a parsed paper's section
  // headings + section instructions ("Answer all questions in this
  // section...") show once above the relevant questions, the same grouping
  // the teacher review page already uses.
  const blockGroups = useMemo(() => {
    if (!content) return [];
    const groups = new Map<number, { number: number; q: (typeof content.questions)[number] }[]>();
    content.questions.forEach((q, i) => {
      const arr = groups.get(q.block_index) ?? [];
      arr.push({ number: i + 1, q });
      groups.set(q.block_index, arr);
    });
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [content]);

  function setAnswer(qid: string, value: HomeworkAnswer) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }

  async function handleWholePaperSelect(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0 || !student) return;
    setWholePaperUploading(true);
    setWholePaperError(null);
    const { results, error } = await uploadHomeworkAnswerFiles(student.id, files);
    setWholePaperUploading(false);
    if (error) {
      setWholePaperError(error);
      return;
    }
    // Append to whatever's already attached, so a student can add a PDF and
    // then some photos (or several photos one batch at a time).
    setWholePaperAnswer((prev) => {
      const all = [...wholePaperAnswerFiles(prev), ...results];
      return { file_url: all[0].file_url, file_name: all[0].file_name, files: all };
    });
  }

  function removeWholePaperFile(fileUrl: string) {
    setWholePaperAnswer((prev) => {
      const remaining = wholePaperAnswerFiles(prev).filter((f) => f.file_url !== fileUrl);
      if (remaining.length === 0) return null;
      return { file_url: remaining[0].file_url, file_name: remaining[0].file_name, files: remaining };
    });
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await saveAnswers(answers, wholePaperAnswer);
    setSaving(false);
    setToast(
      error
        ? { message: `Could not save: ${error}`, variant: "error" }
        : { message: "Progress saved.", variant: "success" },
    );
  }

  async function handleSubmit() {
    setConfirmOpen(false);
    setSubmitting(true);
    const { error } = await submit(answers, wholePaperAnswer);
    setSubmitting(false);
    setToast(
      error
        ? { message: `Submitted, but grading failed: ${error}. Your teacher can re-grade.`, variant: "error" }
        : { message: "Submitted — your teacher will review it and share your grade.", variant: "success" },
    );
  }

  // The whole-paper upload block, shown at the TOP of the page (above the
  // questions) so the student sees "attach your whole solution as one PDF" as
  // the primary way to hand in written work before scrolling the questions.
  const attachedFiles = wholePaperAnswerFiles(wholePaperAnswer);
  const wholePaperSection = hasSubjective ? (
    <div className="mb-4 rounded-xl border border-navy-100 p-4">
      <p className="text-sm font-semibold text-navy-700">
        Attach your whole worked solution — a PDF and/or photos
      </p>
      <p className="mt-1 text-xs text-navy-400">
        Covers every written/structured question below at once — your teacher marks it as a whole
        (multiple-choice and fill-in-the-blank still work normally either way). Upload one PDF, a set
        of photos, or a mix.
      </p>

      {grade?.whole_paper_grade ? (
        <div className="mt-3 flex flex-col gap-2">
          <span
            className={`self-start rounded-pill px-2.5 py-1 text-xs font-semibold ${
              grade.whole_paper_grade.awarded >= grade.whole_paper_grade.max
                ? "bg-lime-100 text-lime-700"
                : grade.whole_paper_grade.awarded > 0
                  ? "bg-amber-100 text-amber-700"
                  : "bg-red-50 text-red-600"
            }`}
          >
            {grade.whole_paper_grade.awarded} / {grade.whole_paper_grade.max}
          </span>
          {wholePaperImages.length > 0 && (
            <AnnotatableMedia
              images={wholePaperImages}
              annotations={grade.whole_paper_grade.annotations}
              editable={false}
              indexKey="page"
              readingWidthPx={768}
            />
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {!submitted && (
            <input
              type="file"
              accept={WHOLE_PAPER_ACCEPT}
              multiple
              disabled={wholePaperUploading}
              onChange={(e) => {
                handleWholePaperSelect(e.target.files);
                e.target.value = ""; // allow re-selecting / adding the same file again
              }}
              className="text-xs text-navy-500 file:mr-3 file:rounded-pill file:border-0 file:bg-navy-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-navy-700"
            />
          )}
          {wholePaperUploading && <p className="text-xs text-navy-400">Uploading…</p>}
          {wholePaperError && <p className="text-xs text-red-500">{wholePaperError}</p>}
          {attachedFiles.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {attachedFiles.map((f) => (
                <li
                  key={f.file_url}
                  className="flex items-center gap-2 rounded-lg bg-lime-50 px-3 py-2 text-sm text-navy-700"
                >
                  <span className="flex-1 truncate">{f.file_name}</span>
                  {!submitted && (
                    <button
                      type="button"
                      onClick={() => removeWholePaperFile(f.file_url)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {submitted && attachedFiles.length === 0 && (
            <p className="text-xs text-navy-300">Submitted — awaiting your teacher's review.</p>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <StudentLayout>
      <div className="mb-3">
        <Link to="/student/homework" className="text-sm text-navy-400 hover:text-navy-600">
          ← Back to My Homework
        </Link>
      </div>

      {studentLoading || loading ? (
        <div className="flex items-center gap-2 text-navy-300 py-12">
          <Spinner /> Loading…
        </div>
      ) : error || !paper ? (
        <Card className="p-6">
          <p className="text-sm text-red-600">{error ?? "This homework isn't available."}</p>
        </Card>
      ) : !content ? (
        <Card className="p-6">
          <p className="text-sm text-navy-500">This paper has no questions yet.</p>
        </Card>
      ) : (
        <>
          <PageHeader
            title="Homework"
            description={`${content.total_questions} questions · ${content.total_marks} marks`}
            action={
              <HomeworkExportButtons
                paper={paper}
                sheets={["question"]}
                meta={{ studentDisplay: student ? `Student ${student.id}` : undefined }}
              />
            }
          />

          {grade && (
            <div className="mb-4 rounded-xl border border-lime-200 bg-lime-50 px-4 py-3 text-sm text-navy-700">
              <span className="font-semibold">
                Your score: {gradeEffectiveTotal(grade)} /{" "}
                {gradeMaxTotal(grade)}
              </span>
              {grade.teacher_reviewed_at && " (reviewed by your teacher)"}
            </div>
          )}

          {submitted && !grade && (
            <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-navy-700">
              Submitted — your teacher is reviewing this and will share your grade soon.
            </div>
          )}

          {content.paper_instructions && (
            <Card className="mb-4 p-4">
              <QuestionMarkdown text={content.paper_instructions} />
            </Card>
          )}

          {wholePaperSection}

          <div className="flex flex-col gap-5">
            {blockGroups.map(([blockIndex, items]) => {
              const block = paper.blocks[blockIndex];
              // Only show a section header when it's actually informative —
              // several blocks (so the student can tell them apart), or a
              // section carrying its own instruction text or stimulus. A
              // single generic block with nothing to say keeps the page
              // exactly as before.
              const showHeader = blockGroups.length > 1 || !!block?.instructions || !!block?.stimulus;
              return (
                <div key={blockIndex} className="flex flex-col gap-3">
                  {showHeader && (
                    <div>
                      {block?.style && (
                        <h2 className="text-sm font-bold text-navy-700">{styleName(block.style)}</h2>
                      )}
                      {block?.instructions && (
                        <div className="mt-1 text-sm text-navy-500">
                          <QuestionMarkdown text={block.instructions} />
                        </div>
                      )}
                      {block?.stimulus && (
                        <div className="mt-2 rounded-lg border border-navy-100 bg-navy-50/40 p-3">
                          <StimulusContent text={block.stimulus} figures={block.stimulus_figures} />
                        </div>
                      )}
                    </div>
                  )}
                  {items.map(({ number, q }) => (
                    <QuestionAttemptCard
                      key={q.id}
                      question={q}
                      number={number}
                      answer={answers[q.id] ?? null}
                      onChange={(v) => setAnswer(q.id, v)}
                      disabled={submitted}
                      grade={grade?.per_question_json[q.id]}
                      studentId={student?.id}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {!submitted && (
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={handleSave} disabled={saving || submitting}>
                {saving ? "Saving…" : "Save progress"}
              </Button>
              <Button size="md" onClick={() => setConfirmOpen(true)} disabled={submitting || saving}>
                {submitting ? "Submitting…" : "Submit"}
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Submit this homework?"
        description={
          wholePaperAnswer
            ? "Your worked solution is attached for your teacher to mark. You can't change your answers after submitting."
            : unanswered > 0
              ? `${unanswered} question${unanswered === 1 ? "" : "s"} still unanswered. You can't change your answers after submitting.`
              : "You can't change your answers after submitting."
        }
        confirmLabel="Submit"
        isDangerous={!wholePaperAnswer && unanswered > 0}
        onConfirm={handleSubmit}
        onCancel={() => setConfirmOpen(false)}
      />

      {toast && (
        <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </StudentLayout>
  );
}
