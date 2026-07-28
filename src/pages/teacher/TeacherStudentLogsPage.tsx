import { TeacherLayout } from "./TeacherLayout";
import { SessionLogsListView } from "../../components/sessionLogs/SessionLogsListView";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useStudents } from "../../hooks/useStudents";

// Performance-coach-only view: every session logged for a student assigned to
// this coach, by any teacher, filterable down to one of their own assigned
// students. Split out of TeacherSessionsPage so it can live in the strictly-PC
// nav section while the coach's own session logging stays in the shared section.
export default function TeacherStudentLogsPage() {
  const { teacher, loading: teacherLoading, error: teacherError } = useMyTeacherProfile();
  const { activeAssignments } = usePcAssignments();
  const { students } = useStudents();

  const assignedStudentIds = activeAssignments
    .filter((a) => a.pc_teacher_id === teacher?.id)
    .map((a) => a.student_id);
  const studentFilterOptions = assignedStudentIds
    .map((id) => students.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ value: s.id, label: `${s.id} — ${s.first_name} ${s.last_name}` }));

  const errorBanner = teacherError && (
    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
      {teacherError}
    </p>
  );

  return (
    <TeacherLayout>
      <SessionLogsListView
        role="teacher"
        title="My Students' Session Logs"
        description="Every session logged for a student assigned to you, by any teacher."
        addSessionPath="/teacher/sessions/new"
        addButtonLabel="Log a session"
        addDisabled={!teacher}
        detailPath={(id) => `/teacher/sessions/${id}`}
        emptyMessage={
          assignedStudentIds.length === 0
            ? "No students have been assigned to you yet."
            : "No session logs found for your students."
        }
        scopeToStudentIds={assignedStudentIds}
        studentFilterOptions={studentFilterOptions}
        showTeacherColumn
        hideCoordinatorFilter
        extraLoading={teacherLoading}
        errorBanner={errorBanner}
      />
    </TeacherLayout>
  );
}
