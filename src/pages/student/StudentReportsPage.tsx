import { StudentScreen } from "./StudentScreen";
import { StudentReportsView } from "../../components/portal/StudentReportsView";

export default function StudentReportsPage() {
  return (
    <StudentScreen
      title="Reports"
      description="The reports your Performance Coach has generated for you."
      render={(student) => <StudentReportsView student={student} />}
    />
  );
}
