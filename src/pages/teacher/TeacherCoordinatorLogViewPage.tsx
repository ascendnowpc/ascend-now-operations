import { TeacherLayout } from "./TeacherLayout";
import { CoordinatorLogDetailView } from "../../components/coordinatorLogs/CoordinatorLogDetailView";

export default function TeacherCoordinatorLogViewPage() {
  return (
    <TeacherLayout>
      <CoordinatorLogDetailView
        backListPath="/teacher/coordinator-logs"
      />
    </TeacherLayout>
  );
}
