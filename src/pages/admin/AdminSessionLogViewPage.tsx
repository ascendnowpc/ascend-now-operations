import { AdminLayout } from "./AdminLayout";
import { SessionLogDetailView } from "../../components/sessionLogs/SessionLogDetailView";

// Thin wrapper — all the actual field-list UI lives in the shared
// SessionLogDetailView so the admin and teacher session-detail pages can
// never drift apart again. Admin can always edit (unless the month is
// locked) and sees the raw session ID as its own field.
export default function AdminSessionLogViewPage() {
  return (
    <AdminLayout>
      <SessionLogDetailView
        backPath="/admin/session-logs"
        backLabel="Back"
        editPath={(id) => `/admin/session-logs/${id}/edit`}
        canEditBase
        showId
        descriptionWhenUnlocked="Full session record — every field on file."
        notFoundTitle="Session log not found"
        notFoundMessage="We couldn't find this session log."
        notFoundBackLabel="Back to session logs"
      />
    </AdminLayout>
  );
}
