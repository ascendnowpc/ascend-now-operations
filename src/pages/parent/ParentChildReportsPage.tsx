import { ParentChildScreen } from "./ParentChildScreen";
import { StudentReportsView } from "../../components/portal/StudentReportsView";

// The reports an admin/PC generated and published for this child, in the same
// sectioned format and with the same downloadable PDF the child gets. RLS only
// releases an invoice once published_to_student_at is set, so an unpublished
// draft can't reach a parent any more than it can reach the student.
export default function ParentChildReportsPage() {
  return (
    <ParentChildScreen
      title="Reports"
      render={(student) => <StudentReportsView student={student} />}
    />
  );
}
