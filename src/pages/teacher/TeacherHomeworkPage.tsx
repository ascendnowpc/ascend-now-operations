import { useMemo, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Toast } from "../../components/ui/Toast";
import { StudentSearch } from "../../components/ui/StudentSearch";
import { SessionLogPicker } from "../../components/homework/SessionLogPicker";
import { AcademicSubjectPicker } from "../../components/homework/AcademicSubjectPicker";
import { HomeworkResultsList } from "../../components/homework/HomeworkResultsList";
import { Spinner } from "../../components/ui/Spinner";
import { useAuth } from "../../context/AuthContext";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { useStyleTemplates } from "../../hooks/useStyleTemplates";
import { useGeneratedPapers, PARSE_ACCEPT_ATTR } from "../../hooks/useGeneratedPapers";
import { useContentUpload, useTeacherUploads } from "../../hooks/useContentUpload";
import { ContentScopePicker } from "../../components/homework/ContentScopePicker";
import { useSessionLogs } from "../../hooks/useSessionLogs";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useTeachers } from "../../hooks/useTeachers";
import { useAllCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups } from "../../hooks/useCurriculumGroups";
import {
  assignHomeworkNumbers,
  paperDisplayName,
  teacherPaperStage,
  TEACHER_STAGE_LABEL,
  TEACHER_STAGE_BADGE,
} from "../../utils/homeworkGrading";
import type {
  Student,
  PaperBlock,
  PaperDifficulty,
  ContentSourceType,
  ContentScope,
} from "../../types/database";

const DIFFICULTIES: { value: PaperDifficulty; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "scaffolded", label: "Scaffolded" },
  { value: "stretch", label: "Stretch" },
  { value: "eal", label: "EAL (language support)" },
];

const emptyBlock = (): PaperBlock => ({ count: 5, style: "" });

const selectClass =
  "w-full rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300";

type BuilderTab = "generate" | "parse";
// PC-only top-level split: looking up a student's existing results is a
// separate task from building them a new paper, so each gets its own tab
// instead of both being stacked on the page at once.
type PageView = "results" | "generate";

export default function TeacherHomeworkPage() {
  const { profile } = useAuth();
  const { teacher, loading: teacherLoading, error: teacherError } = useMyTeacherProfile();
  const isCoach = profile?.role === "performance_coach" || teacher?.is_performance_coach === true;
  const { templates, loading: templatesLoading } = useStyleTemplates();
  const { subjects } = useAllSubjects();
  const { teachers } = useTeachers();
  const { curricula } = useAllCurricula();
  const { groups } = useAllCurriculumGroups();
  const navigate = useNavigate();
  const {
    papers,
    submissionByPaper,
    gradeByPaper,
    loading: papersLoading,
    createDraftPaper,
    clonePaperForStudent,
    parseExistingPaper,
    retryGeneration,
  } = useGeneratedPapers(teacher?.id);
  const {
    upload,
    uploading,
    error: uploadError,
    uploadAndIndex,
    reset: resetUpload,
    reindex,
    adopt,
  } = useContentUpload();

  const [tab, setTab] = useState<BuilderTab>("generate");
  const [pageView, setPageView] = useState<PageView>("generate");
  const [student, setStudent] = useState<Student | null>(null);
  // Separate from the builder's own `student` above — a PC looking up a
  // student's results isn't necessarily also building them a paper right now,
  // so this gets its own picker rather than repurposing the builder's.
  const [resultsStudent, setResultsStudent] = useState<Student | null>(null);
  const [sourceType, setSourceType] = useState<ContentSourceType>("session_log");
  const [sessionLogId, setSessionLogId] = useState<number | "">("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [contentScope, setContentScope] = useState<ContentScope | null>(null);
  const [difficulty, setDifficulty] = useState<PaperDifficulty>("standard");
  const [mode, setMode] = useState<"simple" | "blocks">("simple");
  const [simpleCount, setSimpleCount] = useState(15);
  const [simpleStyle, setSimpleStyle] = useState("");
  const [blocks, setBlocks] = useState<PaperBlock[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(null);
  const [reuseSourceId, setReuseSourceId] = useState<number | "">("");
  const [reuseCurriculumId, setReuseCurriculumId] = useState<number | null>(null);
  const [reuseSubjectId, setReuseSubjectId] = useState<number | null>(null);
  const [cloning, setCloning] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseFileKey, setParseFileKey] = useState(0);
  // Subject for an upload-only generate (no session log to inherit it from).
  const [genCurriculumId, setGenCurriculumId] = useState<number | null>(null);
  const [genSubjectId, setGenSubjectId] = useState<number | null>(null);
  // Subject for the "upload a past paper" (parse) flow.
  const [parseCurriculumId, setParseCurriculumId] = useState<number | null>(null);
  const [parseSubjectId, setParseSubjectId] = useState<number | null>(null);
  // "" = auto (the picked student, or the first student with papers); "__all__"
  // shows every paper. Kept out of the default so the list isn't cluttered with
  // every student's papers at once.
  const [papersFilter, setPapersFilter] = useState<string>("");

  // Sessions for the picked student, scoped to this teacher's own logs.
  const { logs: sessionLogs, loading: logsLoading } = useSessionLogs(
    student ? { studentId: student.id } : {},
    teacher?.id,
  );

  // This teacher's own previously uploaded materials, across every student
  // they've uploaded for — a teacher often reuses the same source PDF for
  // several students, so this isn't scoped to just the one currently picked.
  const { uploads: priorUploads, refetch: refetchUploads } = useTeacherUploads(teacher?.id);

  const subjectName = useMemo(() => {
    const m = new Map(subjects.map((s) => [s.id, s.name]));
    return (id: number | null) => (id != null ? m.get(id) ?? null : null);
  }, [subjects]);
  const teacherName = useMemo(() => {
    const m = new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()]));
    return (id: string | null) => (id != null ? m.get(id) ?? null : null);
  }, [teachers]);
  const curriculumName = useMemo(() => {
    const m = new Map(curricula.map((c) => [c.id, c.name]));
    return (id: number | null) => (id != null ? m.get(id) ?? null : null);
  }, [curricula]);

  // The builder only offers the generic (board = null) templates — MCQ, Fill
  // in the Blanks, True/False, Short Answer, Long Answer. The curriculum-
  // specific templates (IBDP, IGCSE, AP, ...) and the subject-hierarchy
  // resolver that picks the most-specific variant still exist and still work
  // (a paper already built from one keeps resolving/rendering exactly as
  // before) — this page just no longer surfaces them when building a new
  // paper. See db/docs/HOMEWORK_GENERATOR_ARCHITECTURE.md.
  const genericTemplates = useMemo(() => templates.filter((t) => !t.board), [templates]);

  // This teacher's own papers for OTHER students that have generated content
  // — candidates for "reuse this paper" once a student is picked, so the same
  // question/answer sheet can be handed to more than one student without
  // regenerating from scratch.
  const reusableCandidates = useMemo(
    () =>
      student
        ? papers.filter((p) => p.student_id !== student.id && p.questions_json != null)
        : [],
    [papers, student],
  );

  // Per-student serial numbers — "Homework 1, 2, 3…" restarting at 1 for each
  // student, regardless of the underlying DB id (see assignHomeworkNumbers).
  const homeworkNumbers = useMemo(() => assignHomeworkNumbers(papers), [papers]);

  // A readable name for a paper: its subject (so a teacher can tell papers
  // apart at a glance) plus the per-student "Homework N". Falls back to a bare
  // "Homework N" when a paper has no subject.
  const paperName = (p: { id: number; subject_id: number | null }) =>
    paperDisplayName(p, subjectName, homeworkNumbers.get(p.id) ?? "—");

  // Students that actually have papers, for the "Your papers" filter dropdown.
  const studentIdsWithPapers = useMemo(
    () => [...new Set(papers.map((p) => p.student_id))].sort(),
    [papers],
  );
  // Default the filter to the picked student (or the first with papers) rather
  // than showing every student's papers at once. Only default to the picked
  // student when they actually have papers, so the shown dropdown value always
  // matches an option (and the paper list it filters to).
  const effectiveFilter =
    papersFilter ||
    (student && studentIdsWithPapers.includes(student.id) ? student.id : "") ||
    studentIdsWithPapers[0] ||
    "__all__";
  const visiblePapers = useMemo(() => {
    const list =
      effectiveFilter === "__all__"
        ? papers
        : papers.filter((p) => p.student_id === effectiveFilter);
    // Order by the per-student serial ("Homework 1, 2, 3…").
    return [...list].sort(
      (a, b) => (homeworkNumbers.get(a.id) ?? 0) - (homeworkNumbers.get(b.id) ?? 0),
    );
  }, [papers, effectiveFilter, homeworkNumbers]);

  function resetReuse() {
    setReuseSourceId("");
    setReuseCurriculumId(null);
    setReuseSubjectId(null);
  }

  async function handleReuse() {
    if (!student || !teacher || !reuseSourceId || reuseSubjectId == null) return;
    const source = papers.find((p) => p.id === reuseSourceId);
    if (!source) return;
    setCloning(true);
    const { paper, error } = await clonePaperForStudent(source, student.id, teacher.id, {
      subjectId: reuseSubjectId,
      curriculumId: reuseCurriculumId,
    });
    setCloning(false);
    if (error || !paper) {
      setToast({ message: `Could not reuse paper: ${error ?? "unknown error"}`, variant: "error" });
      return;
    }
    navigate(`/teacher/homework/${paper.id}`);
  }

  // Upload an existing paper (PDF or photo) → create a 'parsed' draft → kick off
  // parsing → jump straight to its review page, where the teacher watches it
  // parse, then reviews and publishes. No composition/generation is involved.
  async function handleParseFile(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reset the input so picking the same file(s) again re-fires onChange.
    setParseFileKey((k) => k + 1);
    if (files.length === 0 || !student || !teacher) return;
    setParsing(true);
    const { paper, error } = await parseExistingPaper(student.id, teacher.id, files, {
      subjectId: parseSubjectId,
      curriculumId: parseCurriculumId,
    });
    setParsing(false);
    if (error || !paper) {
      setToast({ message: `Could not upload paper: ${error ?? "unknown error"}`, variant: "error" });
      return;
    }
    navigate(`/teacher/homework/${paper.id}`);
  }

  const selectedLog = sessionLogs.find((l) => l.id === sessionLogId) ?? null;

  // Simple mode is just one block (the picked generic type); Blocks mode
  // passes its rows straight through.
  const effectiveBlocks: PaperBlock[] = useMemo(() => {
    if (mode === "blocks") return blocks;
    return [{ count: simpleCount, style: simpleStyle }];
  }, [mode, blocks, simpleStyle, simpleCount]);

  const totalQuestions = effectiveBlocks.reduce((sum, b) => sum + (Number(b.count) || 0), 0);

  const needsSession = sourceType === "session_log" || sourceType === "both";
  const needsUpload = sourceType === "upload" || sourceType === "both";
  // A session log already carries the subject, so we only ask the teacher to
  // pick one when generating purely from an upload (no session log present).
  const needsSubjectPick = sourceType === "upload";

  function validate(): string | null {
    if (!student) return "Pick a student first.";
    if (needsSession && !sessionLogId) return "Choose a session log as the content source.";
    if (needsUpload && !upload) return "Upload a file to use as the content source.";
    if (needsUpload && uploading) return "Wait for the upload to finish.";
    if (needsSubjectPick && genSubjectId == null) return "Pick the subject this paper is for.";
    if (totalQuestions < 1) return "Add at least one question.";
    if (effectiveBlocks.some((b) => !b.style)) return "Every block needs a question style.";
    return null;
  }

  async function handleGenerate() {
    const err = validate();
    if (err) {
      setToast({ message: err, variant: "error" });
      return;
    }
    if (!student || !teacher) return;
    setSubmitting(true);

    // The upload (if any) was already created + indexed when the file was
    // picked, so we just reference its id here — no re-upload at generate time.
    const contentUploadId = needsUpload ? (upload?.id ?? null) : null;

    // Subject/curriculum name the paper. Taken from the session log when there
    // is one (session_log / both) since it already records the subject; asked
    // of the teacher for an upload-only paper (no session log to inherit from).
    const subjectId = needsSession ? (selectedLog?.subject_id ?? null) : genSubjectId;
    const curriculumId = needsSession ? (selectedLog?.curriculum_id ?? null) : genCurriculumId;

    const { error } = await createDraftPaper({
      studentId: student.id,
      createdByTeacherId: teacher.id,
      subjectId,
      curriculumId,
      contentSourceType: sourceType,
      sessionLogId: needsSession ? Number(sessionLogId) : null,
      contentUploadId,
      contentScope: needsUpload ? contentScope : null,
      blocks: effectiveBlocks.map((b) => ({ count: Number(b.count), style: b.style })),
      difficulty,
    });
    setSubmitting(false);
    if (error) {
      setToast({ message: `Could not create paper: ${error}`, variant: "error" });
      return;
    }
    setToast({
      message: `Draft paper created (${totalQuestions} questions). Generating now — review comes next.`,
      variant: "success",
    });
    // Reset the composition, keep the student selected for quick repeats.
    setSessionLogId("");
    setContentScope(null);
    setFileInputKey((k) => k + 1);
    resetUpload();
    setBlocks([]);
    setGenCurriculumId(null);
    setGenSubjectId(null);
  }

  const tabBtn = (t: BuilderTab, label: string) => (
    <button
      key={t}
      type="button"
      onClick={() => setTab(t)}
      className={`shrink-0 whitespace-nowrap rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${
        tab === t ? "bg-navy-600 text-white shadow-sm" : "text-navy-500 hover:bg-navy-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <TeacherLayout>
      <PageHeader
        title="Homework Generator"
        description="Build a paper, or upload an existing one — then review and publish it to the student."
      />

      {teacherError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
          {teacherError}
        </p>
      )}

      {/* PC-only top-level split — looking up a student's results and
          building them a new paper are two separate tasks, so a PC gets a
          tab per task instead of both stacked on the page at once. A plain
          teacher only ever builds their own papers (see isCoach gating
          below), so they keep the single generate view with no tab bar.
          Same underline tab-bar style as StudentDetailView.tsx's Details /
          Learner's actual hours / Homework / Reports tabs. */}
      {isCoach && (
        <div className="flex gap-0 border-b border-navy-100 mb-6">
          {(
            [
              ["generate", "Generate homework"],
              ["results", "Student results"],
            ] as [PageView, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setPageView(v)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                pageView === v
                  ? "border-sky-500 text-sky-600"
                  : "border-transparent text-navy-400 hover:text-navy-600 hover:border-navy-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {isCoach && pageView === "results" ? (
        // PC-only — look up any student's results directly, not just papers
        // this PC built themselves (RLS already grants a performance coach
        // full read access to every generated_papers/submissions/grades row,
        // same as the Homework tab on the student-detail page).
        <Card className="p-5">
          <h2 className="text-sm font-bold text-navy-700 mb-3">A student's homework & results</h2>
          <div className="max-w-sm mb-4">
            <StudentSearch label="" value={resultsStudent?.id ?? null} onChange={setResultsStudent} />
          </div>
          <HomeworkResultsList studentId={resultsStudent?.id} subjectName={subjectName} teacherName={teacherName} linkable />
        </Card>
      ) : teacherLoading || templatesLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2 flex flex-col gap-5">
            {/* Student — shared by both tabs */}
            <Card className="p-5">
              <h2 className="text-sm font-bold text-navy-700 mb-3">Student</h2>
              <StudentSearch
                value={student?.id ?? null}
                onChange={(s) => {
                  setStudent(s);
                  setSessionLogId("");
                  setContentScope(null);
                  setFileInputKey((k) => k + 1);
                  resetUpload();
                  resetReuse();
                  setGenCurriculumId(null);
                  setGenSubjectId(null);
                  setParseCurriculumId(null);
                  setParseSubjectId(null);
                }}
                required
              />
            </Card>

            {/* Two ways in: build a fresh paper, or upload an existing one.
                overflow-x-auto + nowrap so a narrow viewport scrolls this
                pill row horizontally instead of wrapping it to a second
                line or squeezing the buttons. */}
            <div className="flex max-w-full gap-1 overflow-x-auto whitespace-nowrap rounded-pill bg-navy-50 p-1 self-start">
              {tabBtn("generate", "Generate a paper")}
              {tabBtn("parse", "Upload a past paper")}
            </div>

            {tab === "generate" ? (
              <>
                {/* Reuse a paper already built for another student. */}
                {student && reusableCandidates.length > 0 && (
                  <Card className="p-5">
                    <h2 className="text-sm font-bold text-navy-700 mb-3">
                      Reuse a paper from another student
                    </h2>
                    <div className="flex flex-col gap-3">
                      <select
                        value={reuseSourceId}
                        onChange={(e) =>
                          setReuseSourceId(e.target.value ? Number(e.target.value) : "")
                        }
                        className={selectClass}
                      >
                        <option value="">Choose a paper…</option>
                        {reusableCandidates.map((p) => {
                          const totalQ = p.questions_json?.total_questions ?? 0;
                          return (
                            <option key={p.id} value={p.id}>
                              {p.student_id} · Homework {homeworkNumbers.get(p.id) ?? "—"} ·{" "}
                              {[subjectName(p.subject_id), curriculumName(p.curriculum_id)]
                                .filter(Boolean)
                                .join(" · ") || "No subject"}{" "}
                              · {totalQ} {totalQ === 1 ? "question" : "questions"}
                            </option>
                          );
                        })}
                      </select>

                      {reuseSourceId && (
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-navy-500">
                            Subject for this paper
                            <span className="text-red-400 ml-0.5">*</span>
                          </label>
                          <AcademicSubjectPicker
                            curricula={curricula}
                            allGroups={groups}
                            subjects={subjects}
                            curriculumId={reuseCurriculumId}
                            subjectId={reuseSubjectId}
                            onChange={({ curriculumId, subjectId }) => {
                              setReuseCurriculumId(curriculumId);
                              setReuseSubjectId(subjectId);
                            }}
                          />
                        </div>
                      )}

                      <div>
                        <Button
                          variant="secondary"
                          onClick={handleReuse}
                          disabled={!reuseSourceId || reuseSubjectId == null || cloning}
                        >
                          {cloning ? "Reusing…" : "Use this paper"}
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Content source */}
                <Card className="p-5">
                  <h2 className="text-sm font-bold text-navy-700 mb-3">Content source</h2>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(
                      [
                        ["session_log", "Session log"],
                        ["upload", "Upload file"],
                        ["both", "Both"],
                      ] as [ContentSourceType, string][]
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setSourceType(val);
                          if (val === "session_log") {
                            // No longer need an upload — drop it.
                            setContentScope(null);
                            setFileInputKey((k) => k + 1);
                            resetUpload();
                          }
                        }}
                        className={`rounded-pill px-3 py-1.5 text-sm font-semibold border transition-colors ${
                          sourceType === val
                            ? "bg-navy-600 text-white border-navy-600"
                            : "bg-white text-navy-600 border-navy-200 hover:bg-navy-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {needsSession && (
                    <div className="flex flex-col gap-1 mb-3">
                      <label className="text-xs font-medium text-navy-500">
                        Session log{needsUpload ? " (also required)" : ""}
                        <span className="text-red-400 ml-0.5">*</span>
                      </label>
                      {!student ? (
                        <p className="text-sm text-navy-300">Pick a student first.</p>
                      ) : (
                        <SessionLogPicker
                          logs={sessionLogs}
                          loading={logsLoading}
                          subjectName={subjectName}
                          curriculumName={curriculumName}
                          value={sessionLogId}
                          onChange={setSessionLogId}
                        />
                      )}
                    </div>
                  )}

                  {needsUpload && (
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-navy-500">
                        Upload material
                        <span className="text-red-400 ml-0.5">*</span>
                      </label>
                      {!student ? (
                        <p className="text-sm text-navy-300">Pick a student first.</p>
                      ) : (
                        <>
                          {/* Reuse any file this teacher has already uploaded — for this
                              student or any other one, since the same source material
                              (e.g. a textbook chapter) is often reused across students. */}
                          {priorUploads.length > 0 && (
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] font-medium text-navy-400">
                                Reuse a previous upload
                              </label>
                              <select
                                value={upload?.id ?? ""}
                                onChange={(e) => {
                                  const id = e.target.value ? Number(e.target.value) : null;
                                  setContentScope(null);
                                  setFileInputKey((k) => k + 1);
                                  if (id == null) {
                                    resetUpload();
                                    return;
                                  }
                                  const row = priorUploads.find((u) => u.id === id);
                                  if (row) adopt(row);
                                }}
                                className="rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                              >
                                <option value="">— Upload a new file below —</option>
                                {priorUploads.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.file_name} · {u.student_id}
                                    {u.file_type === "pdf" && u.outline_status === "completed"
                                      ? " (indexed)"
                                      : u.file_type === "pdf"
                                        ? " (not indexed)"
                                        : ""}
                                    {" · "}
                                    {new Date(u.created_at).toLocaleDateString()}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          <input
                            key={fileInputKey}
                            type="file"
                            accept=".pdf,.ppt,.pptx,.docx"
                            disabled={uploading}
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              setContentScope(null);
                              if (f && student && teacher) {
                                await uploadAndIndex(student.id, teacher.id, f);
                                refetchUploads();
                              } else {
                                resetUpload();
                              }
                            }}
                            className="text-sm text-navy-600 file:mr-3 file:rounded-pill file:border-0 file:bg-lime-300 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-navy-700 hover:file:bg-lime-400 disabled:opacity-50"
                          />
                        </>
                      )}

                      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
                      {uploading && (
                        <p className="text-xs text-navy-400 flex items-center gap-1">
                          <Spinner size={12} /> Uploading…
                        </p>
                      )}

                      {upload && !uploading && (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-navy-500">{upload.file_name}</p>

                          {upload.file_type === "pdf" ? (
                            upload.outline_status === "pending" ||
                            upload.outline_status === "processing" ? (
                              <p className="text-xs text-sky-600 flex items-center gap-1">
                                <Spinner size={12} /> Indexing chapters & sections…
                              </p>
                            ) : upload.outline_status === "failed" ? (
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-amber-600">
                                  Couldn't index this PDF (
                                  {upload.outline_error ?? "unknown error"}). You can still
                                  generate from the whole document.
                                </p>
                                <Button variant="ghost" size="sm" onClick={reindex}>
                                  Retry
                                </Button>
                              </div>
                            ) : upload.outline ? (
                              <ContentScopePicker
                                outline={upload.outline}
                                value={contentScope}
                                onChange={setContentScope}
                              />
                            ) : null
                          ) : (
                            <p className="text-xs text-amber-600">
                              Only PDFs can be indexed into chapters/sections — this file will be
                              used as a whole. PPT/PPTX/DOCX generation isn't supported yet.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Card>

                {/* Subject — only asked when there's no session log to take it
                    from (an upload-only paper). It names the paper. */}
                {needsSubjectPick && student && (
                  <Card className="p-5">
                    <h2 className="text-sm font-bold text-navy-700 mb-3">Subject</h2>
                    <AcademicSubjectPicker
                      curricula={curricula}
                      allGroups={groups}
                      subjects={subjects}
                      curriculumId={genCurriculumId}
                      subjectId={genSubjectId}
                      onChange={({ curriculumId, subjectId }) => {
                        setGenCurriculumId(curriculumId);
                        setGenSubjectId(subjectId);
                      }}
                    />
                  </Card>
                )}

                {/* Composition */}
                <Card className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold text-navy-700">Paper composition</h2>
                    <div className="flex gap-1 rounded-pill bg-navy-50 p-0.5">
                      {(["simple", "blocks"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m)}
                          className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${
                            mode === m ? "bg-white text-navy-700 shadow-sm" : "text-navy-400"
                          }`}
                        >
                          {m === "simple" ? "Simple" : "Blocks"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {mode === "simple" ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-navy-500">Questions</label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={simpleCount}
                          onChange={(e) => setSimpleCount(Math.max(1, Number(e.target.value)))}
                          className="w-24 rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        />
                      </div>
                      <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
                        <label className="text-xs font-medium text-navy-500">Question type</label>
                        <select
                          value={simpleStyle}
                          onChange={(e) => setSimpleStyle(e.target.value)}
                          className={selectClass}
                        >
                          <option value="">Select a question type…</option>
                          {genericTemplates.map((t) => (
                            <option key={t.code} value={t.code}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {blocks.length === 0 && (
                        <p className="text-sm text-navy-300">
                          No blocks yet. Add one per question type you want (e.g. 10 MCQ + 5 Short
                          Answer).
                        </p>
                      )}
                      {blocks.map((b, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-navy-100 p-3 flex flex-wrap items-end gap-3"
                        >
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-navy-500">Count</label>
                            <input
                              type="number"
                              min={1}
                              max={50}
                              value={b.count}
                              onChange={(e) =>
                                setBlocks((prev) =>
                                  prev.map((x, j) =>
                                    j === i
                                      ? { ...x, count: Math.max(1, Number(e.target.value)) }
                                      : x,
                                  ),
                                )
                              }
                              className="w-20 rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                            />
                          </div>
                          <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
                            <label className="text-xs font-medium text-navy-500">
                              Question type
                            </label>
                            <select
                              value={b.style}
                              onChange={(e) =>
                                setBlocks((prev) =>
                                  prev.map((x, j) =>
                                    j === i ? { ...x, style: e.target.value } : x,
                                  ),
                                )
                              }
                              className={selectClass}
                            >
                              <option value="">Select a question type…</option>
                              {genericTemplates.map((t) => (
                                <option key={t.code} value={t.code}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={() => setBlocks((prev) => prev.filter((_, j) => j !== i))}
                            className="rounded-pill px-3 py-2 text-sm text-red-500 hover:bg-red-50"
                            aria-label="Remove block"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setBlocks((prev) => [...prev, emptyBlock()])}
                        >
                          + Add block
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-navy-50 flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-navy-500">Difficulty</label>
                      <select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value as PaperDifficulty)}
                        className="rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                      >
                        {DIFFICULTIES.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-sm text-navy-400 ml-auto">
                      Total: <span className="font-bold text-navy-700">{totalQuestions}</span>{" "}
                      questions
                    </p>
                  </div>
                </Card>

                <div className="flex justify-end">
                  <Button onClick={handleGenerate} disabled={submitting}>
                    {submitting ? "Creating…" : "Generate draft"}
                  </Button>
                </div>
              </>
            ) : (
              /* Upload a past paper — Gemini reads the questions straight off it. */
              <Card className="p-5">
                <h2 className="text-sm font-bold text-navy-700 mb-3">Upload a past paper</h2>
                {!student ? (
                  <p className="text-sm text-navy-300">Pick a student first.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-navy-500">
                        Subject
                        <span className="text-red-400 ml-0.5">*</span>
                      </label>
                      <AcademicSubjectPicker
                        curricula={curricula}
                        allGroups={groups}
                        subjects={subjects}
                        curriculumId={parseCurriculumId}
                        subjectId={parseSubjectId}
                        onChange={({ curriculumId, subjectId }) => {
                          setParseCurriculumId(curriculumId);
                          setParseSubjectId(subjectId);
                        }}
                      />
                    </div>
                    {parseSubjectId == null ? null : (
                      <input
                        key={parseFileKey}
                        type="file"
                        accept={PARSE_ACCEPT_ATTR}
                        multiple
                        disabled={parsing}
                        onChange={handleParseFile}
                        className="text-sm text-navy-600 file:mr-3 file:rounded-pill file:border-0 file:bg-lime-300 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-navy-700 hover:file:bg-lime-400 disabled:opacity-50"
                      />
                    )}
                  </div>
                )}
                {parsing && (
                  <p className="mt-2 text-xs text-navy-400 flex items-center gap-1">
                    <Spinner size={12} /> Uploading… opening the paper for review.
                  </p>
                )}
              </Card>
            )}
          </div>

          {/* Your papers */}
          <div className="lg:col-span-1">
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-bold text-navy-700">Your papers</h2>
                {studentIdsWithPapers.length > 0 && (
                  <select
                    value={effectiveFilter}
                    onChange={(e) => setPapersFilter(e.target.value)}
                    className="rounded-lg border border-navy-100 px-2 py-1 text-xs text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300 max-w-[9rem]"
                  >
                    <option value="__all__">All students</option>
                    {studentIdsWithPapers.map((sid) => (
                      <option key={sid} value={sid}>
                        {sid}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {papersLoading ? (
                <Spinner />
              ) : papers.length === 0 ? (
                <p className="text-sm text-navy-300">
                  No papers yet. Build one on the left to get started.
                </p>
              ) : visiblePapers.length === 0 ? (
                <p className="text-sm text-navy-300">No papers for this student yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {visiblePapers.map((p) => {
                    const totalQ =
                      (p.blocks ?? []).reduce((s, b) => s + (Number(b.count) || 0), 0) || 0;
                    const isGenerating =
                      p.status === "draft" && p.questions_json == null && !p.generation_error;
                    const isFailed = p.status === "draft" && !!p.generation_error;
                    const isParsed = p.content_source_type === "parsed";
                    return (
                      <li key={p.id}>
                        <Link
                          to={`/teacher/homework/${p.id}`}
                          className="block rounded-xl border border-navy-50 px-3 py-2.5 flex flex-col gap-1 hover:border-navy-200 hover:bg-navy-50/40 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-navy-700">
                              {paperName(p)}
                            </span>
                            {isGenerating ? (
                              <span className="rounded-pill px-2 py-0.5 text-[11px] font-semibold bg-sky-50 text-sky-600 flex items-center gap-1">
                                <Spinner size={12} /> {isParsed ? "Parsing…" : "Generating…"}
                              </span>
                            ) : isFailed ? (
                              <span className="rounded-pill px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700">
                                {isParsed ? "Parse failed" : "Generation failed"}
                              </span>
                            ) : (
                              (() => {
                                const stage = teacherPaperStage(
                                  p,
                                  submissionByPaper.get(p.id) ?? null,
                                  gradeByPaper.get(p.id) ?? null,
                                );
                                return (
                                  <span
                                    className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${TEACHER_STAGE_BADGE[stage]}`}
                                  >
                                    {TEACHER_STAGE_LABEL[stage]}
                                  </span>
                                );
                              })()
                            )}
                          </div>
                          <p className="text-xs text-navy-400">
                            {p.student_id} · {totalQ} questions
                            {curriculumName(p.curriculum_id)
                              ? ` · ${curriculumName(p.curriculum_id)}`
                              : ""}
                            {" · "}
                            {new Date(p.created_at).toLocaleDateString()}
                          </p>
                          {isFailed && (
                            <div className="flex items-center justify-between gap-2 mt-1">
                              <p
                                className="text-xs text-red-500 truncate"
                                title={p.generation_error ?? ""}
                              >
                                {p.generation_error}
                              </p>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  retryGeneration(p.id);
                                }}
                              >
                                Retry
                              </Button>
                            </div>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {toast && (
        <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </TeacherLayout>
  );
}
