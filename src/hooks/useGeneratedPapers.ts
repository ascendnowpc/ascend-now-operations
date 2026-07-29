import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { invokeEdgeFunction } from "../lib/edgeFunctions";
import { rasterizePdfToImages, PdfPageLimitError } from "../utils/rasterizePdf";
import type {
  GeneratedPaper,
  PaperBlock,
  PaperDifficulty,
  ContentSourceType,
  ContentUpload,
  ContentScope,
  Submission,
  Grade,
} from "../types/database";

const POLL_INTERVAL_MS = 4000;
// A draft paper still unresolved this long after the client first sees it is a
// dead edge worker: the platform hard-kills a generate/parse worker at its
// ~150s wall-clock limit (a 504 whose catch block never runs, so it writes no
// generation_error), and nothing legitimate runs past this. The poll then marks
// it failed client-side instead of letting the "Generating…/Parsing…" badge spin
// forever. 4 min matches the indexing flow's dead-worker grace window.
const GENERATION_TIMEOUT_MS = 240_000;

export interface CreatePaperInput {
  studentId: string;
  createdByTeacherId: string;
  subjectId?: number | null;
  curriculumId?: number | null;
  contentSourceType: ContentSourceType;
  sessionLogId?: number | null;
  contentUploadId?: number | null;
  contentScope?: ContentScope | null;
  blocks: PaperBlock[];
  difficulty: PaperDifficulty;
}

const FILE_TYPE_MAP: Record<string, string> = {
  pdf: "pdf",
  ppt: "ppt",
  pptx: "pptx",
  docx: "docx",
};

// Accepted files for the "parse an existing paper" flow: a PDF of a past paper,
// or a photo/scan of one. Kept in step with the content_uploads.file_type CHECK
// (20260726000000_homework_parse_existing_paper.sql) and the parse-homework-paper
// edge function's MIME map.
const PARSE_FILE_TYPE_MAP: Record<string, string> = {
  pdf: "pdf",
  jpg: "jpg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  heic: "heic",
};
export const PARSE_ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,.webp,.heic,image/*,application/pdf";
// Cap the number of photos in a single parsed paper (matches the edge function's
// MAX_PARSE_FILES) — keeps the combined upload sane and bounds Gemini's file parts.
export const MAX_PARSE_FILES = 20;

// Papers created by one teacher, newest first. RLS also allows admins to see
// everything, but this hook is the teacher-facing list so it scopes to the
// caller's own teacher id.
export function useGeneratedPapers(teacherId: string | undefined) {
  const [papers, setPapers] = useState<GeneratedPaper[]>([]);
  // Per-paper submission + grade, so the list can tell "needs the teacher's
  // review" apart from "graded" (a paper's status flips to 'graded' the instant
  // AI grading runs on submit, before any teacher review — see teacherPaperStage).
  const [submissionByPaper, setSubmissionByPaper] = useState<Map<number, Submission>>(new Map());
  const [gradeByPaper, setGradeByPaper] = useState<Map<number, Grade>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!teacherId) {
      setPapers([]);
      setSubmissionByPaper(new Map());
      setGradeByPaper(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("generated_papers")
      .select("*")
      .eq("created_by_teacher_id", teacherId)
      .order("created_at", { ascending: false });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const paperList = data as GeneratedPaper[];
    setPapers(paperList);
    setError(null);

    // Fetch submissions + grades for these papers so the list badge can show
    // "Needs review" until the teacher publishes the grade. The paper owner has
    // read access to both under RLS; a failure here is non-fatal (the list still
    // renders, just without the review-state refinement).
    const paperIds = paperList.map((p) => p.id);
    if (paperIds.length > 0) {
      const { data: subs } = await supabase
        .from("submissions")
        .select("*")
        .in("paper_id", paperIds);
      const subList = (subs as Submission[]) ?? [];
      setSubmissionByPaper(new Map(subList.map((s) => [s.paper_id, s])));

      const subIds = subList.map((s) => s.id);
      if (subIds.length > 0) {
        const { data: gradeRows } = await supabase
          .from("grades")
          .select("*")
          .in("submission_id", subIds);
        const subToPaper = new Map(subList.map((s) => [s.id, s.paper_id]));
        const gMap = new Map<number, Grade>();
        for (const g of (gradeRows as Grade[]) ?? []) {
          const pid = subToPaper.get(g.submission_id);
          if (pid != null) gMap.set(pid, g);
        }
        setGradeByPaper(gMap);
      } else {
        setGradeByPaper(new Map());
      }
    } else {
      setSubmissionByPaper(new Map());
      setGradeByPaper(new Map());
    }
    setLoading(false);
  }, [teacherId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Uploads a source document to the private homework-content bucket and records
  // a content_uploads row (parse_status stays 'pending' — Phase 4 parses it).
  async function uploadContent(
    studentId: string,
    teacherIdArg: number,
    file: File,
  ): Promise<{ upload: ContentUpload | null; error: string | null }> {
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const fileType = FILE_TYPE_MAP[ext];
    if (!fileType) {
      return { upload: null, error: "Only PDF, PPT, PPTX, or DOCX files are supported." };
    }
    const path = `${studentId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("homework-content")
      .upload(path, file, { upsert: false });
    if (uploadError) return { upload: null, error: uploadError.message };

    const { data, error } = await supabase
      .from("content_uploads")
      .insert({
        student_id: studentId,
        uploaded_by_teacher_id: teacherIdArg,
        file_name: file.name,
        file_url: path,
        file_type: fileType,
        parse_status: "pending",
      })
      .select()
      .single();
    if (error) return { upload: null, error: error.message };
    return { upload: data as ContentUpload, error: null };
  }

  // Invokes the Phase 4 generation edge function for a draft paper. Fired
  // without blocking the caller — the function writes questions_json/
  // generation_error on the row directly, and the polling effect below picks
  // up the result on generated_papers, not on this call's return value.
  function triggerGeneration(paperId: number) {
    invokeEdgeFunction("generate-homework-paper", { body: { paper_id: paperId } }).then(
      ({ error }) => {
        if (error) refetch();
      },
    );
  }

  // Same fire-and-forget shape as triggerGeneration, but for a 'parsed' paper —
  // parse-homework-paper transcribes the uploaded paper into questions_json
  // instead of generating new questions. The poll (questions_json === null &&
  // !generation_error) is identical, so the "Parsing…" badge clears the same way.
  function triggerParse(paperId: number) {
    invokeEdgeFunction("parse-homework-paper", { body: { paper_id: paperId } }).then(
      ({ error }) => {
        if (error) refetch();
      },
    );
  }

  // Uploads an existing paper — a single PDF, or one or more photos/scans of it
  // (one per page) — and creates a 'parsed' draft paper, then kicks off
  // parse-homework-paper to transcribe its questions + build the answer key. No
  // composition/session log/style template is involved — the questions come
  // straight off the uploaded paper. Returns the new draft so the caller can
  // navigate to its review page immediately.
  async function parseExistingPaper(
    studentId: string,
    teacherIdArg: string,
    files: File[],
    // The subject/curriculum the teacher says this paper is for — used to name
    // the paper (a parsed paper has no session log to inherit it from).
    subject?: { subjectId: number | null; curriculumId: number | null },
  ): Promise<{ paper: GeneratedPaper | null; error: string | null }> {
    if (files.length === 0) return { paper: null, error: "Choose a file to upload." };
    if (files.length > MAX_PARSE_FILES) {
      return { paper: null, error: `Upload at most ${MAX_PARSE_FILES} photos at once.` };
    }
    let typed = files.map((file) => ({
      file,
      type: PARSE_FILE_TYPE_MAP[(file.name.split(".").pop() ?? "").toLowerCase()],
    }));
    if (typed.some((t) => !t.type)) {
      return { paper: null, error: "Upload PDFs or photos (JPG, PNG, WebP or HEIC) only." };
    }
    // A single PDF is fine (it can be multi-page); several files must all be
    // images — you can't meaningfully stitch multiple PDFs into one paper here.
    if (files.length > 1 && typed.some((t) => t.type === "pdf")) {
      return { paper: null, error: "Upload one PDF, or several photos — not multiple PDFs." };
    }

    // Rasterize a PDF into one page-image per page, client-side, before
    // uploading anything. parse-homework-paper crops exact figures (charts,
    // diagrams, graphs) straight out of the page pixels it's given, which needs
    // a real raster image — a raw PDF byte stream can't be decoded/cropped that
    // way in its Deno runtime. This also means a rasterized PDF simply reuses
    // the multi-photo upload path below, indistinguishable from a teacher
    // having photographed each page. A genuinely too-long PDF surfaces as a
    // real error (PdfPageLimitError); any other rasterization failure (a
    // corrupt/encrypted file) falls back to uploading the raw PDF — parsing
    // still works via Gemini's own PDF reading, it just can't crop figures off it.
    if (typed.length === 1 && typed[0].type === "pdf") {
      try {
        const pages = await rasterizePdfToImages(typed[0].file);
        if (pages.length > 0) typed = pages.map((file) => ({ file, type: "jpg" }));
      } catch (err) {
        if (err instanceof PdfPageLimitError) return { paper: null, error: err.message };
        // Fall back to the original PDF file — see comment above.
      }
    }

    // Upload every page and record its content_uploads row (parsed directly,
    // never indexed — outline_status 'failed' keeps the indexing UI from
    // treating it as pending) IN PARALLEL rather than one at a time — a
    // multi-page paper (a rasterized PDF can be 15-20 pages) was slow to
    // upload when each page's storage-upload + DB-insert round trip waited
    // for the previous one to finish. Promise.all preserves array order
    // regardless of completion order, so uploadIds still comes out in the
    // paper's actual page order.
    const uploadResults = await Promise.all(
      typed.map(async ({ file, type }): Promise<{ id: number } | { error: string }> => {
        const ext = (file.name.split(".").pop() ?? "").toLowerCase();
        const path = `${studentId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("homework-content")
          .upload(path, file, { upsert: false });
        if (uploadError) return { error: uploadError.message };

        const { data: uploadRow, error: uploadInsertError } = await supabase
          .from("content_uploads")
          .insert({
            student_id: studentId,
            uploaded_by_teacher_id: teacherIdArg,
            file_name: file.name,
            file_url: path,
            file_type: type,
            parse_status: "pending",
            outline_status: "failed",
            outline_error: "Uploaded as an existing paper to parse — not indexed into chapters.",
          })
          .select()
          .single();
        if (uploadInsertError) return { error: uploadInsertError.message };
        return { id: (uploadRow as ContentUpload).id };
      }),
    );
    const failed = uploadResults.find((r): r is { error: string } => "error" in r);
    if (failed) return { paper: null, error: failed.error };
    const uploadIds = uploadResults.map((r) => (r as { id: number }).id);

    const { data: paperRow, error: paperError } = await supabase
      .from("generated_papers")
      .insert({
        student_id: studentId,
        created_by_teacher_id: teacherIdArg,
        subject_id: subject?.subjectId ?? null,
        curriculum_id: subject?.curriculumId ?? null,
        content_source_type: "parsed",
        session_log_id: null,
        // First id satisfies the source-check constraint / back-compat; the full
        // ordered list is used by the edge function when there's more than one.
        content_upload_id: uploadIds[0],
        content_upload_ids: uploadIds.length > 1 ? uploadIds : null,
        content_scope: null,
        blocks: [],
        difficulty: "standard",
        questions_json: null,
        status: "draft",
      })
      .select()
      .single();
    if (paperError) return { paper: null, error: paperError.message };

    const paper = paperRow as GeneratedPaper;
    setPapers((prev) => [paper, ...prev]);
    triggerParse(paper.id);
    return { paper, error: null };
  }

  // Writes a draft paper with the requested blocks (questions_json starts
  // null) and kicks off async generation via the edge function.
  async function createDraftPaper(
    input: CreatePaperInput,
  ): Promise<{ paper: GeneratedPaper | null; error: string | null }> {
    const { data, error } = await supabase
      .from("generated_papers")
      .insert({
        student_id: input.studentId,
        created_by_teacher_id: input.createdByTeacherId,
        subject_id: input.subjectId ?? null,
        curriculum_id: input.curriculumId ?? null,
        content_source_type: input.contentSourceType,
        session_log_id: input.sessionLogId ?? null,
        content_upload_id: input.contentUploadId ?? null,
        content_scope: input.contentScope ?? null,
        blocks: input.blocks,
        difficulty: input.difficulty,
        questions_json: null,
        status: "draft",
      })
      .select()
      .single();
    if (error) return { paper: null, error: error.message };
    const paper = data as GeneratedPaper;
    setPapers((prev) => [paper, ...prev]);
    triggerGeneration(paper.id);
    return { paper, error: null };
  }

  // Reuses another paper's already-generated questions_json for a different
  // student, instead of running generation again — for when the same
  // composition/content genuinely fits more than one student. `source` must
  // be a paper this teacher already owns and that has content; the new row
  // starts as a normal draft (still reviewable/editable/publishable through
  // the usual review page), with content_source_type 'cloned' so it doesn't
  // need a session_log/content_upload of its own.
  async function clonePaperForStudent(
    source: Pick<
      GeneratedPaper,
      "id" | "subject_id" | "curriculum_id" | "blocks" | "difficulty" | "questions_json"
    >,
    targetStudentId: string,
    createdByTeacherId: string,
    // The subject/curriculum the reused paper is being assigned to. The teacher
    // picks these from the subject hierarchy at reuse time (the source paper's
    // own subject may not fit the new student), and they name the cloned paper.
    // Falls back to the source paper's own when not supplied.
    override?: { subjectId: number | null; curriculumId: number | null },
  ): Promise<{ paper: GeneratedPaper | null; error: string | null }> {
    if (!source.questions_json) {
      return { paper: null, error: "That paper has no generated content to reuse yet." };
    }
    const { data, error } = await supabase
      .from("generated_papers")
      .insert({
        student_id: targetStudentId,
        created_by_teacher_id: createdByTeacherId,
        subject_id: override ? override.subjectId : source.subject_id,
        curriculum_id: override ? override.curriculumId : source.curriculum_id,
        content_source_type: "cloned",
        session_log_id: null,
        content_upload_id: null,
        content_scope: null,
        blocks: source.blocks,
        difficulty: source.difficulty,
        questions_json: source.questions_json,
        status: "draft",
        cloned_from_paper_id: source.id,
      })
      .select()
      .single();
    if (error) return { paper: null, error: error.message };
    const paper = data as GeneratedPaper;
    setPapers((prev) => [paper, ...prev]);
    return { paper, error: null };
  }

  // Re-invokes processing for a paper that previously failed (generation_error
  // set) or needs a full regenerate. Clears the error optimistically so the
  // list immediately reads as "generating"/"parsing" again, and dispatches to
  // the right edge function based on how the paper was sourced.
  function retryGeneration(paperId: number) {
    const isParsed =
      papers.find((p) => p.id === paperId)?.content_source_type === "parsed";
    setPapers((prev) =>
      prev.map((p) => (p.id === paperId ? { ...p, generation_error: null } : p)),
    );
    if (isParsed) triggerParse(paperId);
    else triggerGeneration(paperId);
  }

  // Marks a stuck draft paper failed client-side. Used when the processing edge
  // worker (generate-homework-paper / parse-homework-paper) is killed before it
  // can write questions_json or generation_error itself — a platform 504/OOM
  // takes the worker down outright and its own catch block never runs, which
  // would otherwise leave the "Generating…/Parsing…" badge spinning forever. The
  // write is conditional (still null, still no error) so it can never clobber a
  // paper that happened to finish between the last poll and this update.
  const markPaperTimedOut = useCallback(
    async (paperId: number, message: string) => {
      await supabase
        .from("generated_papers")
        .update({ generation_error: message })
        .eq("id", paperId)
        .is("questions_json", null)
        .is("generation_error", null);
      refetch();
    },
    [refetch],
  );

  // Polls while any paper is mid-generation/parsing (questions_json null, no
  // error yet) so the badge clears once the edge function finishes — Supabase
  // Realtime isn't wired up here, so this is a plain interval. Each pending paper
  // is also timed from when the client first sees it: one still unresolved past
  // GENERATION_TIMEOUT_MS is a dead worker and gets marked failed rather than
  // left spinning.
  const papersRef = useRef(papers);
  const pendingSinceRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    papersRef.current = papers;
  }, [papers]);
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const seen = pendingSinceRef.current;
      const pending = papersRef.current.filter(
        (p) => p.status === "draft" && p.questions_json == null && !p.generation_error,
      );
      // Forget timers for papers that have resolved (finished or errored).
      const pendingIds = new Set(pending.map((p) => p.id));
      for (const trackedId of [...seen.keys()]) {
        if (!pendingIds.has(trackedId)) seen.delete(trackedId);
      }
      let timedOut = false;
      for (const p of pending) {
        const since = seen.get(p.id) ?? now;
        if (!seen.has(p.id)) seen.set(p.id, since);
        if (now - since > GENERATION_TIMEOUT_MS) {
          seen.delete(p.id);
          timedOut = true;
          markPaperTimedOut(
            p.id,
            p.content_source_type === "parsed"
              ? "Parsing timed out — the paper may be too large or complex for a single pass. Please try again."
              : "Generation timed out — please try again.",
          );
        }
      }
      // markPaperTimedOut refetches on its own, so only poll here when nothing
      // timed out this tick.
      if (pending.length > 0 && !timedOut) refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refetch, markPaperTimedOut]);

  return {
    papers,
    submissionByPaper,
    gradeByPaper,
    loading,
    error,
    refetch,
    uploadContent,
    createDraftPaper,
    clonePaperForStudent,
    parseExistingPaper,
    retryGeneration,
  };
}
