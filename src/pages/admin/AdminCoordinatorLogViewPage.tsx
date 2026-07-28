import { AdminLayout } from "./AdminLayout";
import { CoordinatorLogDetailView } from "../../components/coordinatorLogs/CoordinatorLogDetailView";

export default function AdminCoordinatorLogViewPage() {
  return (
    <AdminLayout>
      <CoordinatorLogDetailView
        backListPath="/admin/coordinator-logs"
      />
    </AdminLayout>
  );
}
