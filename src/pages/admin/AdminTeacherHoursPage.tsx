import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { TeacherHoursTab } from "./AdminReportsPage";

// Standalone "Teacher's Hours" page (/admin/teacher-hours), under the sidebar's
// "Teachers" group. This used to be a sub-tab of the Reports page; the tab
// content (`TeacherHoursTab`) is exported from there and reused here unchanged.
export default function AdminTeacherHoursPage() {
  const now = new Date();
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <AdminLayout>
      <PageHeader
        title="Teacher's Hours"
        description="Hours, sessions and no-show payouts per teacher, by month."
      />
      <TeacherHoursTab years={years} />
    </AdminLayout>
  );
}
