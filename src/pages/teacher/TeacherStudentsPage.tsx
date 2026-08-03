import { TeacherLayout } from "./TeacherLayout";
import { StudentsListView } from "../../components/students/StudentsListView";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useCcAssignments } from "../../hooks/useCcAssignments";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { useStudents } from "../../hooks/useStudents";
import { useAuth } from "../../context/AuthContext";
import { staffRoleFlags } from "../../utils/staffRole";
import { myRosterStudentIds } from "../../utils/staffRoster";

// Thin wrapper — the search/filter/table is the exact same shared
// StudentsListView the admin "Students" page uses (see that component's
// header comment), and a row opens the full student detail view.
//
// This is "My Students" for a performance coach AND a college counsellor:
// the two see the same page, and the only difference is which table their
// assignment lives in, which `myRosterStudentIds` resolves. Neither has a
// self-service assign or remove action: assigning/unassigning is admin-only
// (enforced by RLS — neither role has an INSERT/UPDATE policy on either
// assignment table), done from /admin/pc-assignments and
// /admin/cc-assignments.
export default function TeacherStudentsPage() {
  const { assignments: pcAssignments } = usePcAssignments();
  const { assignments: ccAssignments } = useCcAssignments();
  const { teacher } = useMyTeacherProfile();
  const { profile } = useAuth();
  const { students } = useStudents();

  const { isCoach, isCounsellor } = staffRoleFlags(profile?.role, teacher);
  // `visible` also carries students they completed — completing one closes the
  // assignment, so the Completed tab would otherwise always be empty.
  const { active, visible } = myRosterStudentIds({
    teacherId: teacher?.id,
    isCoach,
    isCounsellor,
    pcAssignments,
    ccAssignments,
    students,
  });

  return (
    <TeacherLayout>
      <StudentsListView
        title="My Students"
        description="Students assigned to you."
        allowedIds={visible}
        detailPath={(id) => `/teacher/students/${id}`}
        emptyMessage="No students have been assigned to you yet. Ask an admin to assign one."
        showPcFilter={false}
        // Only a student currently assigned to you — completing one closes the
        // assignment, and only an admin can re-assign. The set_student_status
        // RPC enforces the same rule.
        canEditStatus={(id) => active.has(id)}
      />
    </TeacherLayout>
  );
}
