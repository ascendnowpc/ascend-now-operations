import { TeacherLayout } from "./TeacherLayout";
import { StudentDetailView } from "../../components/students/StudentDetailView";

// Thin wrapper — shares the exact same StudentDetailView as the admin page
// (`src/components/students/StudentDetailView.tsx`); only the layout, the
// back link, and the role gating differ. As a PC the details are read-only
// and there's no direct "add hours" path, but the reports and pool tools
// are the same, scoped by RLS to this PC's assigned students.
export default function TeacherStudentDetailPage() {
  return (
    <TeacherLayout>
      <StudentDetailView role="pc" backPath="/teacher/students" backLabel="My Students" />
    </TeacherLayout>
  );
}
