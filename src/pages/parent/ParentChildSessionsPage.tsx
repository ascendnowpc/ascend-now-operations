import { ParentChildScreen } from "./ParentChildScreen";
import { StudentSessionsView } from "../../components/portal/StudentSessionsView";

// Every session logged against this child's packages, with the same filters
// and the same columns the child's own Session Logs tab shows — which already
// excludes the coach-internal fields (engagement, feedback, flags) that aren't
// for a student or a parent to read.
export default function ParentChildSessionsPage() {
  return (
    <ParentChildScreen
      title="Session Logs"
      render={(student) => <StudentSessionsView student={student} />}
    />
  );
}
