import { useEffect, useState, type ChangeEvent } from "react";
import { isPhotoAnswer, type GeneratedQuestion, type HomeworkAnswer, type QuestionGrade } from "../../types/database";
import { gradeEffectiveMark, stripOptionLabel } from "../../utils/homeworkGrading";
import { QuestionContent, QuestionMarkdown } from "./QuestionContent";
import { AnnotatableMedia } from "./AnnotatableMedia";
import { uploadHomeworkAnswerFiles, resolveAnswerImages } from "../../utils/homeworkAnswerMedia";

interface Props {
  question: GeneratedQuestion;
  number: number;
  answer: HomeworkAnswer;
  onChange: (answer: HomeworkAnswer) => void;
  disabled: boolean; // read-only once submitted
  grade?: QuestionGrade; // present once graded
  studentId?: string; // needed to upload a photo answer (its storage path)
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

function marksLabel(n: number) {
  return `${n} ${n === 1 ? "mark" : "marks"}`;
}

// One question in the student attempt view: the right input for its type, plus,
// once graded, the awarded marks + feedback (and mark-scheme breakdown / teacher
// override where relevant). Subjective types also offer "upload a photo or PDF
// instead of typing" (for handwritten/math working) — a photo/PDF answer is
// never AI-graded, so once graded it shows the teacher's hand-entered mark and
// comment pins (see AnnotatableMedia) rather than AI feedback/per-point
// breakdown. A PDF is rasterized to page images (resolveAnswerImages) so it
// displays and annotates exactly like a set of photos.
export function QuestionAttemptCard({
  question,
  number,
  answer,
  onChange,
  disabled,
  grade,
  studentId,
}: Props) {
  const isChoice = question.question_type === "mcq" || question.question_type === "true_false";
  const isFill = question.question_type === "fill_blank";
  const isSubjective = !isChoice && !isFill;

  const [mode, setMode] = useState<"write" | "photo">(isPhotoAnswer(answer) ? "photo" : "write");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const photoAnswer = isPhotoAnswer(answer) ? answer : null;
  // `mode`'s initial value above is set from `answer` at first mount, but
  // `answer` is still null on that very first render whenever it's still
  // loading from the submission (StudentHomeworkAttemptPage hydrates `answers`
  // a moment after mount) — so `mode` can get permanently stuck at "write"
  // even once a real photo/PDF answer arrives, since a useState initializer
  // only runs once. Switching to "write" always clears the answer via
  // onChange(null), so a truthy photoAnswer and mode="write" can never
  // legitimately coexist — whenever there IS a saved photo/PDF answer, always
  // show it, regardless of what `mode` happens to be.
  const effectiveMode = photoAnswer ? "photo" : mode;

  useEffect(() => {
    let cancelled = false;
    const files = photoAnswer?.files ?? [];
    (files.length > 0 ? resolveAnswerImages(files) : Promise.resolve([])).then((urls) => {
      if (!cancelled) setPreviewUrls(urls);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoAnswer?.files.map((f) => f.file_url).join(",")]);

  function switchMode(next: "write" | "photo") {
    if (next === mode) return;
    setMode(next);
    setUploadError(null);
    onChange(null); // starting fresh in the new mode — don't leave a stale answer of the old kind
  }

  async function handlePhotoSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file later
    if (files.length === 0 || !studentId) return;
    setUploading(true);
    setUploadError(null);
    const { results, error } = await uploadHomeworkAnswerFiles(studentId, files);
    setUploading(false);
    if (error) {
      setUploadError(error);
      return;
    }
    onChange({ kind: "photo", files: results });
  }

  const isManualGrade = grade?.graded_by === "manual";

  return (
    <div className="rounded-xl border border-navy-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-navy-400">
          <span className="rounded-pill bg-navy-50 px-2 py-0.5 text-navy-600">Q{number}</span>
          <span>{marksLabel(question.marks)}</span>
        </div>
        {grade && (
          <span
            className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${
              gradeEffectiveMark(grade) >= grade.max
                ? "bg-lime-100 text-lime-700"
                : gradeEffectiveMark(grade) > 0
                  ? "bg-amber-100 text-amber-700"
                  : "bg-red-50 text-red-600"
            }`}
          >
            {gradeEffectiveMark(grade)} / {grade.max}
            {grade.teacher_override ? " · teacher" : isManualGrade ? " · teacher-marked" : ""}
          </span>
        )}
      </div>

      <div className="mt-2">
        <QuestionContent prompt={question.prompt} figures={question.figures} />
      </div>

      {/* Input — EVERY question type can be answered by writing/selecting OR by
          uploading a photo of hand-worked working (MCQ and fill-blank included,
          not just subjective). A photo answer is always graded by the teacher. */}
      <div className="mt-3">
        {!disabled && (
          <div className="mb-2 flex gap-1">
            <button
              type="button"
              onClick={() => switchMode("write")}
              className={`rounded-pill px-2.5 py-1 text-xs font-medium ${
                effectiveMode === "write" ? "bg-navy-600 text-white" : "bg-navy-50 text-navy-500 hover:bg-navy-100"
              }`}
            >
              {isChoice ? "Select answer" : "Write answer"}
            </button>
            <button
              type="button"
              onClick={() => switchMode("photo")}
              className={`rounded-pill px-2.5 py-1 text-xs font-medium ${
                effectiveMode === "photo" ? "bg-navy-600 text-white" : "bg-navy-50 text-navy-500 hover:bg-navy-100"
              }`}
            >
              Upload photo or PDF
            </button>
          </div>
        )}

        {effectiveMode === "write" ? (
          isChoice ? (
            <ul className="flex flex-col gap-1">
              {(question.options ?? []).map((opt, i) => {
                const selected = answer === i;
                return (
                  <li key={i}>
                    <label
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer ${
                        selected ? "bg-sky-50 text-navy-700" : "text-navy-600 hover:bg-navy-50"
                      } ${disabled ? "cursor-default" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`q-${question.id}`}
                        checked={selected}
                        disabled={disabled}
                        onChange={() => onChange(i)}
                        className="accent-sky-500"
                      />
                      <span className="text-navy-400">{LETTERS[i] ?? i + 1}.</span>
                      <QuestionMarkdown text={stripOptionLabel(opt)} className="text-sm" />
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : isFill ? (
            <input
              value={typeof answer === "string" ? answer : ""}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Your answer"
              className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:bg-navy-50/40"
            />
          ) : (
            <textarea
              value={typeof answer === "string" ? answer : ""}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              rows={5}
              placeholder="Write your answer"
              className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:bg-navy-50/40"
            />
          )
        ) : (
          <div className="flex flex-col gap-2">
            {!disabled && (
              <input
                type="file"
                accept="application/pdf,.pdf,image/*"
                multiple
                disabled={uploading}
                onChange={handlePhotoSelect}
                className="text-xs text-navy-500 file:mr-3 file:rounded-pill file:border-0 file:bg-navy-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-navy-700"
              />
            )}
            {uploading && <p className="text-xs text-navy-400">Uploading…</p>}
            {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
            {photoAnswer && previewUrls.length > 0 && (
              grade ? (
                <AnnotatableMedia
                  images={previewUrls}
                  annotations={grade.annotations ?? []}
                  editable={false}
                  indexKey="file_index"
                  readingWidthPx={640}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {previewUrls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={`Your upload, page ${i + 1}`}
                      className="h-24 w-24 rounded-lg border border-navy-100 object-cover"
                    />
                  ))}
                </div>
              )
            )}
            {!disabled && photoAnswer && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="self-start text-xs text-red-500 hover:underline"
              >
                Remove
              </button>
            )}
            {!photoAnswer && !uploading && (
              <p className="text-xs text-navy-300">
                Photo/PDF answers are graded by your teacher, not automatically.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Grade feedback */}
      {grade && !isManualGrade && (
        <div className="mt-3 rounded-lg bg-navy-50/60 px-3 py-2.5">
          {grade.feedback && <QuestionMarkdown text={grade.feedback} className="text-sm text-navy-600" />}
          {grade.per_point && grade.per_point.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {grade.per_point.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-navy-500">
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
        </div>
      )}
      {grade && isManualGrade && isSubjective && !photoAnswer && grade.feedback && (
        <div className="mt-3 rounded-lg bg-navy-50/60 px-3 py-2.5">
          <QuestionMarkdown text={grade.feedback} className="text-sm text-navy-600" />
        </div>
      )}
    </div>
  );
}
