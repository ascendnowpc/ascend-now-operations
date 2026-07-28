import { supabase } from "../lib/supabaseClient";

// Uploads / signs a subject-note attachment in the private `subject-notes`
// bucket (see the 20260801000000 migration). A note's file can be any format
// (PDF, DOCX, image, …); it's stored under the student's own id folder so the
// student can read only their own files. Staff (teacher/coach) uploads.

const BUCKET = "subject-notes";
const SIGNED_URL_TTL_SECONDS = 3600;

export interface UploadedNoteFile {
  file_url: string;
  file_name: string;
  file_type: string;
}

export async function uploadSubjectNoteFile(
  studentId: string,
  file: File,
): Promise<{ result: UploadedNoteFile | null; error: string | null }> {
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const path = `${studentId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) return { result: null, error: error.message };
  return {
    result: { file_url: path, file_name: file.name, file_type: file.type || ext },
    error: null,
  };
}

export async function signedSubjectNoteUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

export async function removeSubjectNoteFile(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}
