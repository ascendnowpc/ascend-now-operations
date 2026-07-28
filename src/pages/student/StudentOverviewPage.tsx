import { StudentScreen } from "./StudentScreen";
import { StudentOverviewView } from "../../components/portal/StudentOverviewView";

export default function StudentOverviewPage() {
  return (
    <StudentScreen
      title="Overview"
      description="Your programs, subjects and sessions — all in one place."
      render={(student) => <StudentOverviewView student={student} />}
    />
  );
}
