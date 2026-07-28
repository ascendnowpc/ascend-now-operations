import { TeacherLayout } from "./TeacherLayout";
import { CoordinatorLogsListView } from "../../components/coordinatorLogs/CoordinatorLogsListView";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { usePcAssignments } from "../../hooks/usePcAssignments";

// Thin wrapper — this route is performance-coach-only (see App.tsx), scoped
// to the PC's own currently-assigned students via scopeToStudentIds, same
// mechanism the PC's session-log/student pages already use.
export default function TeacherCoordinatorLogsPage() {
  const { teacher } = useMyTeacherProfile();
  const { activeAssignments } = usePcAssignments();
  const assignedStudentIds = activeAssignments
    .filter((a) => a.pc_teacher_id === teacher?.id)
    .map((a) => a.student_id);

  return (
    <TeacherLayout>
      <CoordinatorLogsListView
        scopeToStudentIds={assignedStudentIds}
        showCoordinatorFilter={false}
        addLogPath="/teacher/coordinator-logs/new"
        detailPath={(id) => `/teacher/coordinator-logs/${id}`}
      />
    </TeacherLayout>
  );
}
