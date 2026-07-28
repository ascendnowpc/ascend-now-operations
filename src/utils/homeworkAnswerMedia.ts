import { supabase } from "../lib/supabaseClient";
import { renderPdfPagesToDataUrls } from "./rasterizePdf";
import { wholePaperAnswerFiles, type WholePaperAnswer } from "../types/database";

// Uploads/views a student's manually-graded homework answer (a photo of
// handwritten/worked answer, or one whole-paper PDF) in the private
// `homework-answers` bucket — see the 20260728010000 migration. Mirrors the
// upload shape used by content_uploads/homework-content, but scoped to a
// student's own students.id folder (student self-upload, not teacher upload).

const BUCKET = "homework-answers";
const SIGNED_URL_TTL_SECONDS = 3600;

export interface UploadedAnswerFile {
  file_url: string;
  file_name: string;
}

export async function uploadHomeworkAnswerFile(
  studentId: string,
  file: File,
): Promise<{ result: UploadedAnswerFile | null; error: string | null }> {
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const path = `${studentId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) return { result: null, error: error.message };
  return { result: { file_url: path, file_name: file.name }, error: null };
}

export async function uploadHomeworkAnswerFiles(
  studentId: string,
  files: File[],
): Promise<{ results: UploadedAnswerFile[]; error: string | null }> {
  const uploads = await Promise.all(files.map((f) => uploadHomeworkAnswerFile(studentId, f)));
  const failed = uploads.find((u) => u.error);
  if (failed) return { results: [], error: failed.error };
  return { results: uploads.map((u) => u.result!), error: null };
}

function isPdfName(fileName: string): boolean {
  return (fileName.split(".").pop() ?? "").toLowerCase() === "pdf";
}

// One answer file resolved to displayable images: a PDF becomes one image per
// page; a photo becomes a single signed-URL image. Returns [] on failure so
// one bad file doesn't sink the whole review surface.
async function resolveAnswerFileImages(file: UploadedAnswerFile): Promise<string[]> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(file.file_url, SIGNED_URL_TTL_SECONDS);
  if (!data?.signedUrl) return [];
  if (!isPdfName(file.file_name)) return [data.signedUrl];
  try {
    return await renderPdfPagesToDataUrls(data.signedUrl);
  } catch {
    return [];
  }
}

// A set of answer files (a per-question photo/PDF answer, or a whole-paper
// answer) resolved to a flat list of displayable images — PDFs expanded
// page-by-page, photos as-is, in file order. Teacher and student both resolve
// the same files in the same order, so an annotation's flat slot index
// (`file_index`/`page`) points at the same image for both.
export async function resolveAnswerImages(files: UploadedAnswerFile[]): Promise<string[]> {
  const perFile = await Promise.all(files.map((f) => resolveAnswerFileImages(f)));
  return perFile.flat();
}

// A whole-paper answer (one PDF and/or several photos) resolved the same way.
export async function resolveWholePaperImages(wpa: WholePaperAnswer | null): Promise<string[]> {
  return resolveAnswerImages(wholePaperAnswerFiles(wpa));
}
