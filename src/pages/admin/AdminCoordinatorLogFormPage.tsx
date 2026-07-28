import { AdminLayout } from "./AdminLayout";
import { CoordinatorLogFormView } from "../../components/coordinatorLogs/CoordinatorLogFormView";
import { useAllSubjects } from "../../hooks/useSubjects";

// Thin wrapper — admin gets every subject regardless of active status
// (useAllSubjects), same convention as the admin session-log form.
export default function AdminCoordinatorLogFormPage() {
  const { subjects: allSubjects } = useAllSubjects();

  return (
    <AdminLayout>
      <CoordinatorLogFormView role="admin" allSubjects={allSubjects} />
    </AdminLayout>
  );
}
