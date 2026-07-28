import { TeacherLayout } from "./TeacherLayout";
import { SessionLogsListView } from "../../components/sessionLogs/SessionLogsListView";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";

// Thin wrapper — shares the exact same SessionLogsListView the admin
// "Session Logs" page uses; only the layout, own-teacher scoping, and a
// couple of role-gated bits (no Teacher filter/column, no duration editor)
// differ. See that component's header comment for the full list.
//
// This page is the coach's / teacher's own session logging and is shared by
// both roles. A Performance Coach's view of sessions logged for their
// assigned students lives on its own page (TeacherStudentLogsPage) so it can
// sit in the strictly-PC nav section.
export default function TeacherSessionsPage() {
  const { teacher, loading: teacherLoading, error: teacherError } = useMyTeacherProfile();

  const isCoach = Boolean(teacher?.is_performance_coach);

  const errorBanner = teacherError && (
    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
      {teacherError}
    </p>
  );

  return (
    <TeacherLayout>
      <SessionLogsListView
        role="teacher"
        title="Session Logging"
        description="Your own sessions. Click any row to view details."
        addSessionPath="/teacher/sessions/new"
        addButtonLabel="Log a session"
        addDisabled={!teacher}
        detailPath={(id) => `/teacher/sessions/${id}`}
        emptyMessage="You haven't logged any sessions yet."
        scopeToTeacherId={teacher?.id}
        hideCoordinatorFilter={isCoach}
        extraLoading={teacherLoading}
        errorBanner={errorBanner}
      />
    </TeacherLayout>
  );
}
