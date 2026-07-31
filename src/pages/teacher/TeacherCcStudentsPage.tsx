import { TeacherLayout } from "./TeacherLayout";
import { StudentsListView } from "../../components/students/StudentsListView";
import { useCcAssignments } from "../../hooks/useCcAssignments";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";

// A College Counsellor's roster. Same shared list the admin and PC pages use,
// scoped to this counsellor's assignments — including completed ones, so a
// student they saw through doesn't vanish along with the session logs written
// for them. Assigning is admin-only (RLS grants a CC read access only), and a
// counsellor doesn't own the student's overall status either, so there's no
// status menu here.
export default function TeacherCcStudentsPage() {
  const { assignments } = useCcAssignments();
  const { teacher } = useMyTeacherProfile();

  const visibleIds = new Set(
    assignments.filter((a) => a.cc_teacher_id === teacher?.id).map((a) => a.student_id)
  );

  return (
    <TeacherLayout>
      <StudentsListView
        title="My Students"
        description="Students assigned to you as their College Counsellor."
        allowedIds={visibleIds}
        emptyMessage="No students have been assigned to you yet. Ask an admin to assign one."
        showPcFilter={false}
        canEditStatus={() => false}
      />
    </TeacherLayout>
  );
}
