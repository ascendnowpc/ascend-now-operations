import { TeacherLayout } from "./TeacherLayout";
import { SessionLogsListView } from "../../components/sessionLogs/SessionLogsListView";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useCcAssignments } from "../../hooks/useCcAssignments";
import { useStudents } from "../../hooks/useStudents";
import { useAuth } from "../../context/AuthContext";
import { loggableStudentIds } from "../../utils/ccAssignment";
import { staffRoleFlags } from "../../utils/staffRole";

// Coordinator view: every session logged for a student on this coach's or
// counsellor's roster, by any teacher, filterable down to one of them. Split
// out of TeacherSessionsPage so it can live in the coordinator nav section
// while their own session logging stays in the shared section.
export default function TeacherStudentLogsPage() {
  const { teacher, loading: teacherLoading, error: teacherError } = useMyTeacherProfile();
  const { profile } = useAuth();
  const { activeAssignments } = usePcAssignments();
  const { activeAssignments: activeCcAssignmentRows } = useCcAssignments();
  const { students } = useStudents();

  // Someone flagged as both a PC and a CC sees both rosters here, matching
  // what `is_my_assigned_student()` lets them read at the RLS level.
  const { isCoach, isCounsellor } = staffRoleFlags(profile?.role, teacher);
  const assignedStudentIds = [
    ...(loggableStudentIds({
      isAdmin: false,
      teacherId: teacher?.id ?? null,
      isCoach,
      isCounsellor,
      activePcAssignments: activeAssignments,
      activeCcAssignments: activeCcAssignmentRows,
    }) ?? new Set<string>()),
  ];
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
