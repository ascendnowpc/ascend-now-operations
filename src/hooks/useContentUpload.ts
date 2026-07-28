import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { invokeEdgeFunction } from "../lib/edgeFunctions";
import type { ContentUpload } from "../types/database";

const POLL_INTERVAL_MS = 3000;

const FILE_TYPE_MAP: Record<string, string> = {
  pdf: "pdf",
  ppt: "ppt",
  pptx: "pptx",
  docx: "docx",
};

// Manages a single homework content upload and its chapter/section indexing.
// A PDF is uploaded immediately on selection (not at generate time) so the
// index-content-upload edge function can extract its outline and the teacher
// can scope generation to one chapter/section before generating.
export function useContentUpload() {
  const [upload, setUpload] = useState<ContentUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refetches the current upload row so outline_status transitions surface.
  const refetch = useCallback(async (id: number) => {
    const { data, error } = await supabase
      .from("content_uploads")
      .select("*")
      .eq("id", id)
      .single();
    if (!error && data) setUpload(data as ContentUpload);
  }, []);

  // Marks the row failed (used when the edge worker dies before it can write a
  // status itself — e.g. a memory/time limit kills it and its catch never runs).
  const markFailed = useCallback(async (uploadId: number, message: string) => {
    await supabase
      .from("content_uploads")
      .update({ outline_status: "failed", outline_error: message })
      .eq("id", uploadId);
    refetch(uploadId);
  }, [refetch]);

  // Poll while the outline is still being extracted. A processing row that
  // hasn't resolved within a grace window is treated as a dead worker and
  // marked failed client-side, so the UI never spins forever.
  const uploadRef = useRef<ContentUpload | null>(null);
  const processingSinceRef = useRef<number | null>(null);
  useEffect(() => {
    uploadRef.current = upload;
  }, [upload]);
  useEffect(() => {
    const id = setInterval(() => {
      const u = uploadRef.current;
      if (u && (u.outline_status === "pending" || u.outline_status === "processing")) {
        if (processingSinceRef.current == null) processingSinceRef.current = Date.now();
        // index-content-upload can now retry a 429 up to twice with waits of
        // up to 60s each (MAX_RETRY_WAIT_MS), on top of file upload/processing
        // time — a legitimate in-progress retry can take longer than the old
        // 2-minute grace window, which would falsely mark a still-working
        // request as a dead worker. 4 minutes comfortably covers that.
        if (Date.now() - processingSinceRef.current > 240_000) {
          processingSinceRef.current = null;
          markFailed(
            u.id,
            "Indexing timed out — the file may be too large or complex. Retry, or generate from the whole document.",
          );
          return;
        }
        refetch(u.id);
      } else {
        processingSinceRef.current = null;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refetch, markFailed]);

  function reset() {
    setUpload(null);
    setError(null);
    processingSinceRef.current = null;
  }

  // Fires the outline-extraction edge function (fire-and-forget; the poll picks
  // up the result). If the invoke itself errors, the edge function's own catch
  // block has already written a specific outline_error to the row before
  // returning its non-2xx response (unless the worker was killed outright —
  // e.g. OOM/timeout — and its catch never ran, in which case the row is still
  // pending/processing). Refetch first so that specific reason survives; only
  // fall back to a generic message when there genuinely isn't one, instead of
  // always overwriting it (which used to erase the real cause of every failure).
  function triggerIndex(uploadId: number) {
    processingSinceRef.current = Date.now();
    invokeEdgeFunction("index-content-upload", { body: { content_upload_id: uploadId } })
      .then(async ({ error }) => {
        if (error) {
          const { data } = await supabase
            .from("content_uploads")
            .select("*")
            .eq("id", uploadId)
            .single();
          const row = data as ContentUpload | null;
          if (row?.outline_status === "failed" && row.outline_error) {
            setUpload(row);
          } else {
            markFailed(
              uploadId,
              "Indexing failed to complete. Retry, or generate from the whole document.",
            );
          }
        } else {
          refetch(uploadId);
        }
      });
  }

  // Adopts an already-uploaded row (the "reuse a previous upload" flow) as the
  // active upload, resuming polling if its outline is still pending/processing.
  function adopt(row: ContentUpload) {
    setError(null);
    setUpload(row);
    processingSinceRef.current =
      row.outline_status === "pending" || row.outline_status === "processing" ? Date.now() : null;
  }

  // Uploads the file to the private bucket, records a content_uploads row, and
  // (for PDFs) kicks off indexing. Returns the new row so the caller can use its
  // id at generate time without re-uploading.
  async function uploadAndIndex(
    studentId: string,
    teacherId: number,
    file: File,
  ): Promise<{ upload: ContentUpload | null; error: string | null }> {
    setUploading(true);
    setError(null);
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const fileType = FILE_TYPE_MAP[ext];
    if (!fileType) {
      const msg = "Only PDF, PPT, PPTX, or DOCX files are supported.";
      setError(msg);
      setUploading(false);
      return { upload: null, error: msg };
    }

    const path = `${studentId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("homework-content")
      .upload(path, file, { upsert: false });
    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return { upload: null, error: uploadError.message };
    }

    const { data, error: insertError } = await supabase
      .from("content_uploads")
      .insert({
        student_id: studentId,
        uploaded_by_teacher_id: teacherId,
        file_name: file.name,
        file_url: path,
        file_type: fileType,
        parse_status: "pending",
        // PDFs get indexed; other types can't be (leave as failed so the UI
        // shows they won't produce an outline).
        outline_status: fileType === "pdf" ? "pending" : "failed",
        outline_error:
          fileType === "pdf" ? null : "Only PDF uploads can be indexed into chapters/sections.",
      })
      .select()
      .single();
    if (insertError) {
      setError(insertError.message);
      setUploading(false);
      return { upload: null, error: insertError.message };
    }

    const row = data as ContentUpload;
    setUpload(row);
    setUploading(false);
    if (row.file_type === "pdf") triggerIndex(row.id);
    return { upload: row, error: null };
  }

  // Re-runs indexing after a failure.
  function reindex() {
    if (!upload) return;
    setUpload({ ...upload, outline_status: "processing", outline_error: null });
    triggerIndex(upload.id);
  }

  return { upload, uploading, error, uploadAndIndex, reset, reindex, adopt };
}

// Lists this teacher's own previously uploaded homework materials, across
// EVERY student they've uploaded for (not just the one currently picked) —
// per RLS a teacher already has full access to every content_uploads row
// they created regardless of which student it was originally uploaded for
// (uploaded_by_teacher_id = my_teacher_id(), no student_id scoping), and the
// same PDF is often genuinely reused for more than one student, so the
// picker shouldn't hide it just because it was first uploaded elsewhere.
// Storage RLS is even broader (any staff can read any homework-content
// object) — the teacher-only scoping here is a deliberate product choice
// (a teacher reuses their own material, not another teacher's), not a
// storage/RLS limitation.
export function useTeacherUploads(teacherId: number | undefined) {
  const [uploads, setUploads] = useState<ContentUpload[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!teacherId) {
      setUploads([]);
      return;
    }
    setLoading(true);
    // Uploads used to parse an EXISTING past paper (content_source_type =
    // 'parsed') are page images / raw scans of that paper, not reusable source
    // material — they must not clutter this picker (the parse flow can produce
    // 15-20 rasterized page rows per paper). Collect their ids so we can drop
    // them below.
    const { data: parsedPapers } = await supabase
      .from("generated_papers")
      .select("content_upload_id, content_upload_ids")
      .eq("created_by_teacher_id", teacherId)
      .eq("content_source_type", "parsed");
    const parsedUploadIds = new Set<number>();
    for (const p of (parsedPapers ?? []) as {
      content_upload_id: number | null;
      content_upload_ids: number[] | null;
    }[]) {
      if (p.content_upload_id != null) parsedUploadIds.add(p.content_upload_id);
      for (const id of p.content_upload_ids ?? []) parsedUploadIds.add(id);
    }

    // Restrict to document uploads (the only file types the "upload material to
    // generate from" flow ever creates + indexes) — this alone excludes every
    // rasterized past-paper page image — then also drop any doc referenced by a
    // parsed paper (the rare raw-PDF fallback of the parse flow).
    const { data, error } = await supabase
      .from("content_uploads")
      .select("*")
      .eq("uploaded_by_teacher_id", teacherId)
      .in("file_type", ["pdf", "ppt", "pptx", "docx"])
      .order("created_at", { ascending: false });
    if (!error && data) {
      setUploads((data as ContentUpload[]).filter((u) => !parsedUploadIds.has(u.id)));
    }
    setLoading(false);
  }, [teacherId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { uploads, loading, refetch };
}
