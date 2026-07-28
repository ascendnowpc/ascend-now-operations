import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/Input";
import { uploadSubjectNoteFile } from "../../utils/subjectNoteFile";

// Self-contained "add a note for this subject" widget — writes a row straight
// to `subject_notes` (a written body and/or an uploaded file in any format).
// Used by the teacher Notes page (`/teacher/notes`) and inline in the
// session-log form as an optional shortcut. Nothing here touches session_logs;
// the note only ever lands in subject_notes and shows on the student Overview.
export function AddSubjectNoteForm({
  studentId,
  teacherId,
  subjectId,
  curriculumId,
  onAdded,
}: {
  studentId: string;
  teacherId: number;
  subjectId: number;
  curriculumId: number | null;
  onAdded?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const canSubmit = title.trim() !== "" && (noteText.trim() !== "" || file != null);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    let filePart: { file_name: string; file_url: string; file_type: string } | null = null;
    if (file) {
      const { result, error: uploadErr } = await uploadSubjectNoteFile(studentId, file);
      if (uploadErr || !result) {
        setError(uploadErr ?? "Could not upload the file.");
        setSaving(false);
        return;
      }
      filePart = result;
    }

    const { error: insertErr } = await supabase.from("subject_notes").insert({
      student_id: studentId,
      teacher_id: teacherId,
      subject_id: subjectId,
      curriculum_id: curriculumId,
      title: title.trim(),
      note_text: noteText.trim() || null,
      file_name: filePart?.file_name ?? null,
      file_url: filePart?.file_url ?? null,
      file_type: filePart?.file_type ?? null,
    });
    setSaving(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setTitle("");
    setNoteText("");
    setFile(null);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
    onAdded?.();
  }

  return (
    <div className="border border-navy-100 rounded-xl p-4 bg-navy-50/40">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-300 mb-3">Add a note</p>
      <div className="space-y-3">
        <TextInput
          label="Note name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Chapter 3 revision notes"
          required
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-navy-500">Note</label>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            placeholder="Type a note…"
            className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-navy-500">Attachment (any format)</label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-navy-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-100 file:px-3 file:py-1.5 file:text-sky-700 file:font-medium hover:file:bg-sky-200"
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : "Add note"}
          </Button>
          {justSaved && <span className="text-xs text-green-600 font-medium">Note added.</span>}
        </div>
      </div>
    </div>
  );
}
