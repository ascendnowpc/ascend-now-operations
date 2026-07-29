import { TeacherLayout } from "./TeacherLayout";
import { StudentsListView } from "../../components/students/StudentsListView";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { useStudents } from "../../hooks/useStudents";

// Thin wrapper — the search/filter/table is the exact same shared
// StudentsListView the admin "Students" page uses (see that component's
// header comment). A PC has NO self-service assign or remove action:
// assigning/unassigning a student to/from a coach is an admin-only action
// (enforced by RLS — the PC INSERT/UPDATE policies on
// pc_student_assignments were removed), done from /admin/pc-assignments.
export default function TeacherStudentsPage() {
  const { activeAssignments, assignments } = usePcAssignments();
  const { teacher } = useMyTeacherProfile();
  const { students } = useStudents();

  const myAssignedIds = new Set(
    activeAssignments.filter((a) => a.pc_teacher_id === teacher?.id).map((a) => a.student_id)
  );

  // Completing a student unassigns them, so the Completed category would
  // always be empty if this list were the active assignments alone. A student
  // the coach saw through to the end still belongs on their list — matched on
  // the coach of their LATEST assignment, so one who changed coaches before
  // finishing shows only under the coach who actually completed them.
  const visibleIds = new Set(myAssignedIds);
  for (const s of students) {
    if (s.status !== "completed") continue;
    const latest = assignments.find((a) => a.student_id === s.id);
    if (latest?.pc_teacher_id === teacher?.id) visibleIds.add(s.id);
  }

  return (
    <TeacherLayout>
      <StudentsListView
        title="My Students"
        description="Students assigned to you as their Performance Coach."
        allowedIds={visibleIds}
        detailPath={(id) => `/teacher/students/${id}`}
        emptyMessage="No students have been assigned to you yet. Ask an admin to assign one."
        showPcFilter={false}
        // A coach may only change the status of a student currently assigned
        // to them — completing one unassigns them, and only an admin can
        // re-assign. The set_student_status RPC enforces the same rule.
        canEditStatus={(id) => myAssignedIds.has(id)}
      />
    </TeacherLayout>
  );
}
