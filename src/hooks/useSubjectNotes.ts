import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { SubjectNote } from "../types/database";
import { removeSubjectNoteFile } from "../utils/subjectNoteFile";

// Subject notes for one student. Used by both the teacher/PC Notes page (to add
// and manage notes) and the student's Overview tab (read-only, RLS-scoped to
// their own record). RLS enforces who can see/write what — this hook just
// fetches every note the caller is allowed to read for the student.
export function useSubjectNotes(studentId: string | null) {
  const [notes, setNotes] = useState<SubjectNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!studentId) {
      setNotes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("subject_notes")
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setNotes(data as SubjectNote[]);
      setError(null);
    }
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function addNote(input: {
    student_id: string;
    teacher_id: number;
    subject_id: number;
    curriculum_id: number | null;
    title: string;
    note_text?: string | null;
    file_name?: string | null;
    file_url?: string | null;
    file_type?: string | null;
  }): Promise<{ data: SubjectNote | null; error: string | null }> {
    const { data, error } = await supabase
      .from("subject_notes")
      .insert({
        student_id: input.student_id,
        teacher_id: input.teacher_id,
        subject_id: input.subject_id,
        curriculum_id: input.curriculum_id,
        title: input.title,
        note_text: input.note_text ?? null,
        file_name: input.file_name ?? null,
        file_url: input.file_url ?? null,
        file_type: input.file_type ?? null,
      })
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    setNotes((prev) => [data as SubjectNote, ...prev]);
    return { data: data as SubjectNote, error: null };
  }

  async function deleteNote(note: SubjectNote): Promise<{ error: string | null }> {
    const { error } = await supabase.from("subject_notes").delete().eq("id", note.id);
    if (error) return { error: error.message };
    // Best-effort file cleanup — the row is already gone regardless.
    if (note.file_url) await removeSubjectNoteFile(note.file_url);
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
    return { error: null };
  }

  return { notes, loading, error, refetch, addNote, deleteNote };
}
