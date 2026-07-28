import { TeacherLayout } from "./TeacherLayout";
import { StudentsListView } from "../../components/students/StudentsListView";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";

// Thin wrapper — the search/filter/table is the exact same shared
// StudentsListView the admin "Students" page uses (see that component's
// header comment). A PC has NO self-service assign or remove action:
// assigning/unassigning a student to/from a coach is an admin-only action
// (enforced by RLS — the PC INSERT/UPDATE policies on
// pc_student_assignments were removed), done from /admin/pc-assignments.
export default function TeacherStudentsPage() {
  const { activeAssignments } = usePcAssignments();
  const { teacher } = useMyTeacherProfile();

  const myAssignedIds = new Set(
    activeAssignments.filter((a) => a.pc_teacher_id === teacher?.id).map((a) => a.student_id)
  );

  return (
    <TeacherLayout>
      <StudentsListView
        title="My Students"
        description="Students assigned to you as their Performance Coach."
        allowedIds={myAssignedIds}
        detailPath={(id) => `/teacher/students/${id}`}
        emptyMessage="No students have been assigned to you yet. Ask an admin to assign one."
        showPcFilter={false}
      />
    </TeacherLayout>
  );
}
