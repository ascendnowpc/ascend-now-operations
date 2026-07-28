import { AdminLayout } from "./AdminLayout";
import { CoordinatorLogsListView } from "../../components/coordinatorLogs/CoordinatorLogsListView";

// Thin wrapper — admin sees every coordinator log (no student scoping; RLS
// itself scopes admin to "all") and gets the Coordinator/PC filter.
export default function AdminCoordinatorLogsPage() {
  return (
    <AdminLayout>
      <CoordinatorLogsListView
        showCoordinatorFilter
        addLogPath="/admin/coordinator-logs/new"
        detailPath={(id) => `/admin/coordinator-logs/${id}`}
      />
    </AdminLayout>
  );
}
