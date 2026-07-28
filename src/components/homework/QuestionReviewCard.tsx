import { useState } from "react";
import { Button } from "../ui/Button";
import { stripOptionLabel } from "../../utils/homeworkGrading";
import { QuestionContent, QuestionMarkdown } from "./QuestionContent";
import type { GeneratedQuestion } from "../../types/database";

type Mode = "answer" | "question";

interface Props {
  question: GeneratedQuestion;
  number: number; // 1-based position in the paper
  mode: Mode;
  editable: boolean; // false once published
  onSave: (updated: GeneratedQuestion) => Promise<void>;
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

function marksLabel(n: number) {
  return `${n} ${n === 1 ? "mark" : "marks"}`;
}

// One question in the review page — renders either the teacher Answer Sheet
// (prompt + answer/mark scheme) or the student Question Sheet preview (prompt
// only), and, on the Answer Sheet, an inline editor for that single question.
export function QuestionReviewCard({
  question,
  number,
  mode,
  editable,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GeneratedQuestion>(question);
  const [saving, setSaving] = useState(false);

  const isChoice = question.question_type === "mcq" || question.question_type === "true_false";
  const isFill = question.question_type === "fill_blank";
  const usesMarkScheme = !isChoice && !isFill;

  function startEdit() {
    setDraft(question);
    setEditing(true);
  }

  function effectiveMarks(q: GeneratedQuestion) {
    if (usesMarkScheme) return (q.mark_scheme ?? []).reduce((s, p) => s + (Number(p.marks) || 0), 0);
    return Number(q.marks) || 0;
  }

  async function save() {
    setSaving(true);
    const cleaned: GeneratedQuestion = {
      ...draft,
      marks: effectiveMarks(draft),
      acceptable_answers: isFill
        ? (draft.acceptable_answers ?? []).map((a) => a.trim()).filter(Boolean)
        : draft.acceptable_answers,
    };
    await onSave(cleaned);
    setSaving(false);
    setEditing(false);
  }

  return (
    <div className="rounded-xl border border-navy-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-navy-400">
          <span className="rounded-pill bg-navy-50 px-2 py-0.5 text-navy-600">Q{number}</span>
          <span className="uppercase tracking-wide">{question.question_type.replace("_", " ")}</span>
          <span className="text-navy-300">·</span>
          <span>{marksLabel(effectiveMarks(question))}</span>
          {!question.generated && (
            <span className="rounded-pill bg-amber-100 px-2 py-0.5 text-amber-700">placeholder</span>
          )}
        </div>
        {mode === "answer" && editable && !editing && (
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="xs" onClick={startEdit}>
              Edit
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-navy-500">
              Question prompt{" "}
              <span className="font-normal text-navy-300">(Markdown — tables, **bold**, etc. supported)</span>
            </span>
            <textarea
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
          </label>
          {(draft.figures ?? []).length > 0 && (
            <p className="text-xs text-navy-400">
              This question has {draft.figures!.length} figure{draft.figures!.length === 1 ? "" : "s"} from the
              original paper — figures aren't edited here, only the text and answer.
            </p>
          )}

          {isChoice && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-navy-500">
                Options (select the correct one)
              </span>
              {(draft.options ?? []).map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`correct-${question.id}`}
                    checked={draft.correct_option === i}
                    onChange={() => setDraft({ ...draft, correct_option: i })}
                    className="accent-lime-500"
                  />
                  <input
                    value={opt}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        options: (draft.options ?? []).map((o, j) => (j === i ? e.target.value : o)),
                      })
                    }
                    className="flex-1 rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        options: (draft.options ?? []).filter((_, j) => j !== i),
                        correct_option:
                          draft.correct_option != null && draft.correct_option > i
                            ? draft.correct_option - 1
                            : draft.correct_option,
                      })
                    }
                    className="rounded-pill px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                    aria-label="Remove option"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setDraft({ ...draft, options: [...(draft.options ?? []), ""] })}
                >
                  + Add option
                </Button>
              </div>
              <label className="flex items-center gap-2">
                <span className="text-xs font-medium text-navy-500">Marks</span>
                <input
                  type="number"
                  min={1}
                  value={draft.marks}
                  onChange={(e) => setDraft({ ...draft, marks: Math.max(1, Number(e.target.value)) })}
                  className="w-20 rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </label>
            </div>
          )}

          {isFill && (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-navy-500">Expected answer</span>
                <input
                  value={draft.expected_answer ?? ""}
                  onChange={(e) => setDraft({ ...draft, expected_answer: e.target.value })}
                  className="w-full rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-navy-500">
                  Also accept (comma-separated)
                </span>
                <input
                  value={(draft.acceptable_answers ?? []).join(", ")}
                  onChange={(e) =>
                    setDraft({ ...draft, acceptable_answers: e.target.value.split(",") })
                  }
                  className="w-full rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-xs font-medium text-navy-500">Marks</span>
                <input
                  type="number"
                  min={1}
                  value={draft.marks}
                  onChange={(e) => setDraft({ ...draft, marks: Math.max(1, Number(e.target.value)) })}
                  className="w-20 rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </label>
            </div>
          )}

          {usesMarkScheme && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-navy-500">
                Mark scheme ({marksLabel(effectiveMarks(draft))} total)
              </span>
              {(draft.mark_scheme ?? []).map((pt, i) => (
                <div key={i} className="flex items-start gap-2">
                  <input
                    value={pt.point}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        mark_scheme: (draft.mark_scheme ?? []).map((p, j) =>
                          j === i ? { ...p, point: e.target.value } : p,
                        ),
                      })
                    }
                    className="flex-1 rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                  <input
                    type="number"
                    min={1}
                    value={pt.marks}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        mark_scheme: (draft.mark_scheme ?? []).map((p, j) =>
                          j === i ? { ...p, marks: Math.max(1, Number(e.target.value)) } : p,
                        ),
                      })
                    }
                    className="w-16 rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        mark_scheme: (draft.mark_scheme ?? []).filter((_, j) => j !== i),
                      })
                    }
                    className="rounded-pill px-2 py-1.5 text-xs text-red-500 hover:bg-red-50"
                    aria-label="Remove mark-scheme point"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      mark_scheme: [...(draft.mark_scheme ?? []), { point: "", marks: 1 }],
                    })
                  }
                >
                  + Add point
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2">
            <QuestionContent prompt={question.prompt} figures={question.figures} />
          </div>

          {isChoice && (
            <ul className="mt-2 flex flex-col gap-1">
              {(question.options ?? []).map((opt, i) => {
                const correct = mode === "answer" && question.correct_option === i;
                return (
                  <li
                    key={i}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                      correct ? "bg-lime-100 text-navy-700 font-semibold" : "text-navy-600"
                    }`}
                  >
                    <span className="text-navy-400">{LETTERS[i] ?? i + 1}.</span>
                    <QuestionMarkdown text={stripOptionLabel(opt)} className="text-sm" />
                    {correct && <span className="ml-auto text-xs text-lime-600">✓ correct</span>}
                  </li>
                );
              })}
            </ul>
          )}

          {isFill && mode === "answer" && (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-1">
              <span className="text-sm font-semibold text-navy-700">Answer:</span>
              {question.expected_answer ? (
                <QuestionMarkdown text={question.expected_answer} className="text-sm text-navy-600" />
              ) : (
                <span className="text-sm text-navy-300">—</span>
              )}
              {(question.acceptable_answers ?? []).length > 0 && (
                <QuestionMarkdown
                  text={`(also: ${(question.acceptable_answers ?? []).join(", ")})`}
                  className="text-sm text-navy-400"
                />
              )}
            </div>
          )}

          {isFill && mode === "question" && (
            <div className="mt-2 h-8 rounded-lg border border-dashed border-navy-200 bg-navy-50/40" />
          )}

          {usesMarkScheme && mode === "answer" && (
            <div className="mt-2">
              <p className="text-xs font-semibold text-navy-500">Mark scheme</p>
              <ul className="mt-1 flex flex-col gap-1">
                {(question.mark_scheme ?? []).map((pt, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-navy-600">
                    <span className="text-navy-300">•</span>
                    <QuestionMarkdown text={pt.point} className="flex-1 text-sm text-navy-600" />
                    <span className="shrink-0 text-xs text-navy-400">{marksLabel(pt.marks)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {usesMarkScheme && mode === "question" && (
            <div className="mt-2 h-20 rounded-lg border border-dashed border-navy-200 bg-navy-50/40" />
          )}
        </>
      )}
    </div>
  );
}
