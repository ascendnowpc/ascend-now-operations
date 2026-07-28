import { TeacherLayout } from "./TeacherLayout";
import { CoordinatorLogFormView } from "../../components/coordinatorLogs/CoordinatorLogFormView";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { useSubjects } from "../../hooks/useSubjects";

// Thin wrapper — the PC's own identity is fixed (no Coordinator dropdown),
// and only active subjects are offered (useSubjects), same convention as the
// PC's session-log form.
export default function TeacherCoordinatorLogFormPage() {
  const { teacher, loading: teacherLoading, error: teacherError } = useMyTeacherProfile();
  const { subjects: allSubjects } = useSubjects();

  return (
    <TeacherLayout>
      <CoordinatorLogFormView
        role="teacher"
        currentTeacher={teacher}
        currentTeacherLoading={teacherLoading}
        currentTeacherError={teacherError}
        allSubjects={allSubjects}
      />
    </TeacherLayout>
  );
}
