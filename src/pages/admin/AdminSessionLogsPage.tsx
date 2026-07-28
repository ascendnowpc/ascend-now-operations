import { AdminLayout } from "./AdminLayout";
import { SessionLogsListView } from "../../components/sessionLogs/SessionLogsListView";

// Thin wrapper — all the actual filter/table/CSV-export UI lives in the
// shared SessionLogsListView so the admin and teacher session-log list
// pages can never drift apart again (they were ~90% byte-identical
// copy-paste before this). The admin sees every session (no
// scopeToTeacherId) and gets the Teacher filter/column plus the
// SessionDurationEditor widget, neither of which the teacher page has.
export default function AdminSessionLogsPage() {
  return (
    <AdminLayout>
      <SessionLogsListView
        role="admin"
        title="Session Logs"
        description="Every tutoring session logged across all teachers. Click any row to view or edit."
        addSessionPath="/admin/session-logs/new"
        addButtonLabel="Add session"
        detailPath={(id) => `/admin/session-logs/${id}`}
        emptyMessage="No session logs found."
      />
    </AdminLayout>
  );
}
