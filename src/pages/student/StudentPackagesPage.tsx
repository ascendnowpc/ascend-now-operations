import { StudentScreen } from "./StudentScreen";
import { StudentPackagesView } from "../../components/portal/StudentPackagesView";

export default function StudentPackagesPage() {
  return (
    <StudentScreen
      title="Package Status"
      description="Hours purchased and used across your packages."
      render={(student) => <StudentPackagesView student={student} />}
    />
  );
}
