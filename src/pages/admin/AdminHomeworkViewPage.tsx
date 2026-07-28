import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { QuestionReviewCard } from "../../components/homework/QuestionReviewCard";
import { QuestionMarkdown, StimulusContent } from "../../components/homework/QuestionContent";
import { TeacherPaperResults } from "../../components/homework/TeacherPaperResults";
import { HomeworkExportButtons } from "../../components/homework/HomeworkExportButtons";
import { useGeneratedPaper } from "../../hooks/useGeneratedPaper";
import { useStyleTemplates } from "../../hooks/useStyleTemplates";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useAllCurricula } from "../../hooks/useCurricula";
import type { GeneratedQuestion } from "../../types/database";

// Read-only admin view of a generated homework paper — reached from the
// Homework tab on the admin student-detail page. Same Question Sheet / Answer
// Sheet / Student's Answers content a teacher/PC sees, but with no editing,
// regeneration, or publishing (those stay teacher/PC actions); TeacherPaper
// results is already read-only for an admin.
export default function AdminHomeworkViewPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const id = paperId ? Number(paperId) : undefined;
  const { paper, loading, error } = useGeneratedPaper(id);
  const { templates } = useStyleTemplates();
  const { subjects } = useAllSubjects();
  const { curricula } = useAllCurricula();

  const [tabOverride, setTabOverride] = useState<"question" | "answer" | "results" | null>(null);

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
  const isResults = paper?.status === "submitted" || paper?.status === "graded";
  const isParsed = paper?.content_source_type === "parsed";
  const tab = tabOverride ?? (isResults ? "results" : "answer");

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

  // Read-only view: QuestionReviewCard requires an onSave, but it's never
  // callable here since editable is false.
  const noop = async () => {};

  return (
    <AdminLayout>
      <div className="mb-3">
        <button onClick={() => navigate(-1)} className="text-sm text-navy-400 hover:text-navy-600">
          ← Back
        </button>
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
                ? "Parsed from an uploaded paper."
                : [subjectName(paper.subject_id), curriculumName(paper.curriculum_id), paper.difficulty]
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

          {!content ? (
            <Card className="p-6">
              <p className="text-sm text-navy-500">
                This paper hasn't finished generating yet.
              </p>
            </Card>
          ) : (
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
                                editable={false}
                                onSave={noop}
                              />
                            ))}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </AdminLayout>
  );
}
