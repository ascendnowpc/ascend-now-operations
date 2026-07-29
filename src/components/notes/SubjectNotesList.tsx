import { useState } from "react";
import type { SubjectNote } from "../../types/database";
import { signedSubjectNoteUrl } from "../../utils/subjectNoteFile";
import { IconDownload } from "../ui/icons";

// Renders a grid of compact note cards (already filtered to one subject).
// Shared by the teacher/PC Notes page and the student Overview tab. A file
// attachment is downloaded via a freshly-signed URL (the bucket is private);
// deletion is only offered when `deletableTeacherId` matches the note's
// author (a teacher can remove their own notes — the student view never
// passes it).
export function SubjectNotesList({
  notes,
  teacherLookup,
  deletableTeacherId,
  onDelete,
}: {
  notes: SubjectNote[];
  teacherLookup: Map<string, string>;
  deletableTeacherId?: string;
  onDelete?: (note: SubjectNote) => void | Promise<void>;
}) {
  if (notes.length === 0) {
    return <p className="text-sm text-navy-400">No notes yet.</p>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          teacherName={teacherLookup.get(note.teacher_id) ?? `Teacher ${note.teacher_id}`}
          canDelete={deletableTeacherId != null && note.teacher_id === deletableTeacherId}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function NoteCard({
  note,
  teacherName,
  canDelete,
  onDelete,
}: {
  note: SubjectNote;
  teacherName: string;
  canDelete: boolean;
  onDelete?: (note: SubjectNote) => void | Promise<void>;
}) {
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleOpen() {
    if (!note.file_url) return;
    setOpening(true);
    const url = await signedSubjectNoteUrl(note.file_url);
    setOpening(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    await onDelete(note);
    // Component unmounts on success (card removed); reset just in case.
    setDeleting(false);
  }

  return (
    <div className="border border-navy-100 rounded-xl p-3 flex flex-col min-w-0">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-navy-700 text-sm break-words min-w-0">{note.title}</p>
        {canDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-[11px] font-medium text-navy-300 hover:text-red-500 disabled:opacity-50 whitespace-nowrap flex-shrink-0"
          >
            {deleting ? "…" : "Remove"}
          </button>
        )}
      </div>
      <p className="text-[11px] text-navy-400 mt-0.5">
        {teacherName} ·{" "}
        {new Date(note.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
      </p>

      {note.note_text && (
        <p className="text-xs text-navy-600 mt-2 whitespace-pre-wrap break-words line-clamp-3">
          {note.note_text}
        </p>
      )}

      {note.file_url && (
        <button
          type="button"
          onClick={handleOpen}
          disabled={opening}
          className="inline-flex items-center gap-1 mt-2.5 text-xs font-medium text-sky-500 hover:text-sky-600 disabled:opacity-50 min-w-0"
        >
          <IconDownload />
          <span className="truncate">{opening ? "Opening…" : note.file_name ?? "Download"}</span>
        </button>
      )}
    </div>
  );
}
