import { TeacherLayout } from "./TeacherLayout";
import { CoordinatorLogsListView } from "../../components/coordinatorLogs/CoordinatorLogsListView";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useCcAssignments } from "../../hooks/useCcAssignments";
import { useAuth } from "../../context/AuthContext";
import { staffRoleFlags } from "../../utils/staffRole";
import { myRosterStudentIds } from "../../utils/staffRoster";

// Thin wrapper — one coordinator log, shared by coaches and counsellors,
// scoped to the logged-in person's own currently-assigned students. That
// roster can come from either assignment table, so it's resolved by
// myRosterStudentIds, the same helper My Students and Students' Logs use, and
// the same rule the `is_my_assigned_student()` RLS policy applies.
export default function TeacherCoordinatorLogsPage() {
  const { teacher } = useMyTeacherProfile();
  const { profile } = useAuth();
  const { assignments: pcAssignments } = usePcAssignments();
  const { assignments: ccAssignments } = useCcAssignments();

  const { isCoach, isCounsellor } = staffRoleFlags(profile?.role, teacher);
  // Live assignments only: a coordinator log is written against a student you
  // currently hold, which is what RLS allows too. `students` is therefore not
  // needed here — that argument only drives the completed-student carry-over.
  const { active } = myRosterStudentIds({
    teacherId: teacher?.id,
    isCoach,
    isCounsellor,
    pcAssignments,
    ccAssignments,
    students: [],
  });

  return (
    <TeacherLayout>
      <CoordinatorLogsListView
        scopeToStudentIds={[...active]}
        showCoordinatorFilter={false}
        addLogPath="/teacher/coordinator-logs/new"
        detailPath={(id) => `/teacher/coordinator-logs/${id}`}
      />
    </TeacherLayout>
  );
}
