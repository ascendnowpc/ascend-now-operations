import type { Teacher, TeacherSubject, TeacherWithSubjects } from "../types/database";

// Merge plain Teacher[] with the subjects map into TeacherWithSubjects[].
// A teacher with no row in the map still gets an empty teacher_subjects array
// rather than undefined, so callers can map over it unconditionally.
export function mergeWithSubjects(
  teachers: Teacher[],
  subjectsByTeacher: Map<string, TeacherSubject[]>
): TeacherWithSubjects[] {
  return teachers.map((t) => ({
    ...t,
    teacher_subjects: (subjectsByTeacher.get(t.id) ?? []).map((s) => ({
      id: s.id,
      subject_id: s.subject_id,
      curriculum_id: s.curriculum_id,
    })),
  }));
}
