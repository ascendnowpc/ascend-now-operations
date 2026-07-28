import { AdminLayout } from "./AdminLayout";
import { SessionLogFormView } from "../../components/sessionLogs/SessionLogFormView";
import { useAllSubjects } from "../../hooks/useSubjects";

// Thin wrapper — all the actual form UI lives in the shared
// SessionLogFormView so the admin and teacher session-log forms can never
// drift apart again. Admin sees every subject (including inactive ones
// still assigned to a teacher, via useAllSubjects) and gets a free-choice
// Teacher dropdown the teacher/coach form doesn't have.
export default function AdminSessionLogFormPage() {
  const { subjects: allSubjects } = useAllSubjects();

  return (
    <AdminLayout>
      <SessionLogFormView role="admin" allSubjects={allSubjects} />
    </AdminLayout>
  );
}
