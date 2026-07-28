import { TeacherLayout } from "./TeacherLayout";
import { SessionLogFormView } from "../../components/sessionLogs/SessionLogFormView";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { useSubjects } from "../../hooks/useSubjects";

// Thin wrapper — shares the exact same SessionLogFormView the admin
// session-log form uses. Teacher/coach identity is fixed (no Teacher
// dropdown), only active subjects are shown (useSubjects, unlike admin's
// useAllSubjects), and editing an existing session is coach-only — all
// handled inside the shared component via role="teacher".
export default function TeacherSessionFormPage() {
  const { teacher, loading: teacherLoading, error: teacherError } = useMyTeacherProfile();
  const { subjects: allSubjects } = useSubjects();

  return (
    <TeacherLayout>
      <SessionLogFormView
        role="teacher"
        currentTeacher={teacher}
        currentTeacherLoading={teacherLoading}
        currentTeacherError={teacherError}
        allSubjects={allSubjects}
      />
    </TeacherLayout>
  );
}
