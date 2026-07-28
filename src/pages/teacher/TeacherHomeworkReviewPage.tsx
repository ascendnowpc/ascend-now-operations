import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { Toast } from "../../components/ui/Toast";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { QuestionReviewCard } from "../../components/homework/QuestionReviewCard";
import { QuestionMarkdown, StimulusContent } from "../../components/homework/QuestionContent";
import { TeacherPaperResults } from "../../components/homework/TeacherPaperResults";
import { HomeworkExportButtons } from "../../components/homework/HomeworkExportButtons";
import { useGeneratedPaper } from "../../hooks/useGeneratedPaper";
import { useStyleTemplates } from "../../hooks/useStyleTemplates";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useAllCurricula } from "../../hooks/useCurricula";
import type { GeneratedQuestion } from "../../types/database";

const POLL_INTERVAL_MS = 4000;
// A paper still generating/parsing this long after this page starts watching it
// is a dead edge worker (the platform hard-kills a generate/parse worker at its
// ~150s wall-clock limit — a 504 whose catch never runs, so no generation_error
// is written). Past this the page marks it failed itself rather than showing
// "Reading the uploaded paper…" forever. 4 min matches the list/indexing flows.
const GENERATION_TIMEOUT_MS = 240_000;

// Phase 5 — Review & Publish. The teacher reviews a generated paper as either
// the Answer Sheet (questions + answers + mark scheme) or the student's
// Question Sheet (questions only), edits or regenerates questions/blocks, then
// Confirm & Publish flips it to the student's dashboard.
export default function TeacherHomeworkReviewPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const id = paperId ? Number(paperId) : undefined;
  const { paper, loading, error, refetch, markTimedOut, saveQuestions, regenerate, publish } =
    useGeneratedPaper(id);
  const { templates } = useStyleTemplates();
  const { subjects } = useAllSubjects();
  const { curricula } = useAllCurricula();

  // Three horizontal tabs inside a paper: the Question Sheet and Answer Sheet
  // (questions_json, editable pre-publish) plus Student's Answers (the
  // submission + grading view, self-contained via TeacherPaperResults — it
  // already handles "no submission yet" gracefully, so it's safe to offer as
  // a tab regardless of paper status, not just once submitted). `tabOverride`
  // is null until the teacher clicks a tab explicitly; until then the
  // effective tab is derived from paper status (Student's Answers once
  // submitted/graded, Answer Sheet otherwise) — a derived value, not an
  // effect, so there's no separate "sync state to paper" step to get wrong.
  const [tabOverride, setTabOverride] = useState<"question" | "answer" | "results" | null>(null);
  const [regenBusy, setRegenBusy] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(
    null,
  );

  const styleName = useMemo(() => {
    const m = new Map(templates.map((t) => [t.code, t.name]));
    return (code: string) => m.get(code) ?? code;
  }, [templates]);
  const subjectName = useMemo(() => {
    const m = new Map(subjects.map((s) => [s.id, s.name]));
    return (n: number | null) => (n != null ? (m.get(n) ?? null) : null);
  }, [subjects]);
  const curriculumName = useMemo(() => {
    const m = new Map(curricula.map((c) => [c.id, c.name]));
    return (n: number | null) => (n != null ? (m.get(n) ?? null) : null);
  }, [curricula]);

  const content = paper?.questions_json ?? null;
  const isPublished = paper?.status !== "draft";
  const isResults = paper?.status === "submitted" || paper?.status === "graded";
  const isGenerating = !!paper && paper.status === "draft" && !content && !paper.generation_error;
  const editable = !isPublished && regenBusy === null;
  const tab = tabOverride ?? (isResults ? "results" : "answer");
  // A 'parsed' paper is transcribed from an uploaded paper — its questions are
  // the paper's own, so there is no per-question/block AI regeneration; the
  // only bulk AI action is a full re-parse of the same upload.
  const isParsed = paper?.content_source_type === "parsed";

  // Poll while the paper is still generating/parsing (it may have been opened
  // straight after a fire-and-forget invoke on the list page). If it never
  // resolves within the grace window, the edge worker died before it could write
  // an error, so mark it failed client-side instead of spinning "Reading the
  // uploaded paper…" forever.
  const generatingSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isGenerating) {
      generatingSinceRef.current = null;
      return;
    }
    if (generatingSinceRef.current == null) generatingSinceRef.current = Date.now();
    const t = setInterval(() => {
      if (
        generatingSinceRef.current != null &&
        Date.now() - generatingSinceRef.current > GENERATION_TIMEOUT_MS
      ) {
        generatingSinceRef.current = null;
        markTimedOut(
          isParsed
            ? "Parsing timed out — the paper may be too large or complex for a single pass. Please try again."
            : "Generation timed out — please try again.",
        );
        return;
      }
      refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [isGenerating, isParsed, refetch, markTimedOut]);

  async function handleSaveQuestion(updated: GeneratedQuestion) {
    if (!content) return;
    const questions = content.questions.map((q) => (q.id === updated.id ? updated : q));
    // Spread the existing content first so paper_instructions (and any other
    // future top-level field) survives a single-question edit instead of
    // being silently dropped — saveQuestions replaces the whole questions_json
    // column with exactly what it's given.
    const { error } = await saveQuestions({
      ...content,
      questions,
      total_questions: questions.length,
      total_marks: questions.reduce((s, q) => s + q.marks, 0),
    });
    setToast(
      error
        ? { message: `Could not save: ${error}`, variant: "error" }
        : { message: "Question saved.", variant: "success" },
    );
  }

  async function handleRegenerate(scope: { block?: number; question?: string }, key: string) {
    setRegenBusy(key);
    const { error } = await regenerate(scope);
    setRegenBusy(null);
    setToast(
      error
        ? {
            message: `${isParsed ? "Re-parsing" : "Regeneration"} failed: ${error}`,
            variant: "error",
          }
        : { message: isParsed ? "Re-parsed." : "Regenerated.", variant: "success" },
    );
  }

  async function handlePublish() {
    setConfirmOpen(false);
    setPublishing(true);
    const { error } = await publish();
    setPublishing(false);
    setToast(
      error
        ? { message: `Could not publish: ${error}`, variant: "error" }
        : { message: "Published — it's now on the student's dashboard.", variant: "success" },
    );
  }

  // Group question indices by their composition block, preserving order.
  const blockGroups = useMemo(() => {
    if (!content || !paper) return [];
    const groups = new Map<number, { number: number; q: GeneratedQuestion }[]>();
    content.questions.forEach((q, i) => {
      const arr = groups.get(q.block_index) ?? [];
      arr.push({ number: i + 1, q });
      groups.set(q.block_index, arr);
    });
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [content, paper]);

  return (
    <TeacherLayout>
      <div className="mb-3">
        <Link to="/teacher/homework" className="text-sm text-navy-400 hover:text-navy-600">
          ← Back to Homework Generator
        </Link>
      </div>

      {loading ? (
        <Spinner />
      ) : error || !paper ? (
        <Card className="p-6">
          <p className="text-sm text-red-600">{error ?? "Paper not found."}</p>
        </Card>
      ) : (
        <>
          <PageHeader
            title={`Homework for ${paper.student_id}`}
            description={
              isParsed
                ? "Parsed from an uploaded paper — review the questions and answer key, then publish."
                : [
                    subjectName(paper.subject_id),
                    curriculumName(paper.curriculum_id),
                    paper.difficulty,
                  ]
                    .filter(Boolean)
                    .join(" · ")
            }
            action={
              content ? (
                <HomeworkExportButtons
                  paper={paper}
                  sheets={["question", "answer"]}
                  meta={{
                    studentDisplay: `Student ${paper.student_id}`,
                    subjectName: subjectName(paper.subject_id),
                    curriculumName: curriculumName(paper.curriculum_id),
                  }}
                />
              ) : undefined
            }
          />

          {paper.status === "published" && (
            <div className="mb-4 rounded-xl border border-lime-200 bg-lime-50 px-4 py-3 text-sm text-navy-700">
              <span className="font-semibold">Published.</span> This paper is on the student's
              dashboard and can no longer be edited
              {paper.published_at
                ? ` (published ${new Date(paper.published_at).toLocaleString()}).`
                : "."}
            </div>
          )}

          {paper.cloned_from_paper_id != null && (
            <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-navy-700">
              Reused from{" "}
              <Link
                to={`/teacher/homework/${paper.cloned_from_paper_id}`}
                className="font-semibold text-sky-700 hover:underline"
              >
                another paper
              </Link>{" "}
              instead of generating fresh content.
            </div>
          )}

          {isGenerating && (
            <Card className="p-6 flex items-center gap-3">
              <Spinner size={16} />
              <p className="text-sm text-navy-500">
                {isParsed
                  ? "Reading the uploaded paper and building the answer key… this can take a little while. The page updates automatically."
                  : "Generating this paper… this can take a little while. The page updates automatically."}
              </p>
            </Card>
          )}

          {!isGenerating && !content && paper.generation_error && (
            <Card className="p-6">
              <p className="text-sm font-semibold text-red-700">
                {isParsed ? "Parsing failed" : "Generation failed"}
              </p>
              <p className="mt-1 text-sm text-red-600">{paper.generation_error}</p>
              <div className="mt-4">
                <Button
                  size="sm"
                  onClick={() => handleRegenerate({}, "all")}
                  disabled={regenBusy !== null}
                >
                  {regenBusy === "all"
                    ? "Retrying…"
                    : isParsed
                      ? "Retry parsing"
                      : "Retry generation"}
                </Button>
              </div>
            </Card>
          )}

          {content && (
            <>
              {/* Tabs */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-1 rounded-pill bg-navy-50 p-0.5">
                  {(
                    [
                      ["question", "Question Sheet"],
                      ["answer", "Answer Sheet"],
                      ["results", "Student's Answers"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTabOverride(key)}
                      className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${
                        tab === key ? "bg-white text-navy-700 shadow-sm" : "text-navy-400"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab !== "results" && (
                  <p className="text-sm text-navy-400">
                    {content.total_questions} questions ·{" "}
                    <span className="font-semibold text-navy-700">{content.total_marks}</span> marks
                  </p>
                )}
              </div>

              {tab === "results" ? (
                <TeacherPaperResults paper={paper} />
              ) : (
                <>
                  {content.paper_instructions && (
                    <Card className="mb-5 p-5">
                      <QuestionMarkdown text={content.paper_instructions} />
                    </Card>
                  )}
                  <div className="flex flex-col gap-5">
                    {blockGroups.map(([blockIndex, items]) => {
                      const block = paper.blocks[blockIndex];
                      return (
                        <Card key={blockIndex} className="p-5">
                          <div className="mb-3">
                            <h2 className="text-sm font-bold text-navy-700">
                              {block ? styleName(block.style) : `Block ${blockIndex + 1}`}
                              <span className="ml-2 font-normal text-navy-400">
                                {items.length} {items.length === 1 ? "question" : "questions"}
                              </span>
                            </h2>
                            {block?.instructions && (
                              <div className="mt-1 text-sm text-navy-500">
                                <QuestionMarkdown text={block.instructions} />
                              </div>
                            )}
                          </div>
                          {block?.stimulus && (
                            <div className="mb-3 rounded-lg border border-navy-100 bg-navy-50/40 p-3">
                              <StimulusContent text={block.stimulus} figures={block.stimulus_figures} />
                            </div>
                          )}
                          <div className="flex flex-col gap-3">
                            {items.map(({ number, q }) => (
                              <QuestionReviewCard
                                key={q.id}
                                question={q}
                                number={number}
                                mode={tab}
                                editable={editable}
                                onSave={handleSaveQuestion}
                              />
                            ))}
                          </div>
                        </Card>
                      );
                    })}
                  </div>

                  {/* Footer actions */}
                  {!isPublished && (
                    <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
                      {/* Parsed papers keep a re-parse action (re-run extraction on
                          the uploaded paper); generated papers have no regenerate. */}
                      {isParsed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRegenerate({}, "all")}
                          disabled={regenBusy !== null}
                        >
                          {regenBusy === "all" ? "Re-parsing…" : "Re-parse paper"}
                        </Button>
                      )}
                      <Button size="md" onClick={() => setConfirmOpen(true)} disabled={publishing}>
                        {publishing ? "Publishing…" : "Confirm & Publish"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Publish this paper?"
        description="It will appear on the student's dashboard and can't be edited afterwards. Review the answer sheet first."
        confirmLabel="Publish"
        isDangerous={false}
        onConfirm={handlePublish}
        onCancel={() => setConfirmOpen(false)}
      />

      {toast && (
        <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </TeacherLayout>
  );
}
