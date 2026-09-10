import { ParentChildScreen } from "./ParentChildScreen";
import { StudentOverviewView } from "../../components/portal/StudentOverviewView";

// The same Overview a student sees of themselves — programs, subjects and the
// sessions under each — rendered for whichever child is open. Read-only for
// both roles, so there is nothing to fork: one view, two audiences.
export default function ParentChildOverviewPage() {
  return (
    <ParentChildScreen
      title="Overview"
      render={(student) => <StudentOverviewView student={student} />}
    />
  );
}
