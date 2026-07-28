import { TeacherLayout } from "./TeacherLayout";
import { SessionLogDetailView } from "../../components/sessionLogs/SessionLogDetailView";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";

// Thin wrapper — shares the exact same SessionLogDetailView the admin
// session-detail page uses. Only a performance-coach-flagged teacher can
// edit their own session (a plain teacher viewing it cannot); the raw
// session ID field isn't shown, and the card is width-constrained.
export default function TeacherSessionViewPage() {
  const { teacher } = useMyTeacherProfile();
  const isCoach = teacher?.is_performance_coach === true;

  return (
    <TeacherLayout>
      <SessionLogDetailView
        backPath="/teacher/sessions"
        backLabel="Back"
        editPath={(id) => `/teacher/sessions/${id}/edit`}
        canEditBase={isCoach}
        showId={false}
        cardClassName="p-6 max-h-[70vh] overflow-y-auto max-w-2xl"
        notFoundTitle="Session not found"
        notFoundMessage="We couldn't find this session."
        notFoundBackLabel="Back to my sessions"
      />
    </TeacherLayout>
  );
}
