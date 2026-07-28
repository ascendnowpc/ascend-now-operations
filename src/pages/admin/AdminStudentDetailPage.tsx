import { AdminLayout } from "./AdminLayout";
import { StudentDetailView } from "../../components/students/StudentDetailView";

// Thin wrapper — all the actual Details / Learner's-actual-hours / Reports
// UI lives in the shared StudentDetailView so the admin and PC pages can
// never drift apart. The admin gets the full-access variant.
export default function AdminStudentDetailPage() {
  return (
    <AdminLayout>
      <StudentDetailView role="admin" backPath="/admin/students" backLabel="Students" />
    </AdminLayout>
  );
}
