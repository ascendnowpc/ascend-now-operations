import { StudentScreen } from "./StudentScreen";
import { StudentSessionsView } from "../../components/portal/StudentSessionsView";

export default function StudentSessionsPage() {
  return (
    <StudentScreen
      title="Session Logs"
      description="Every session logged against your packages."
      render={(student) => <StudentSessionsView student={student} />}
    />
  );
}
