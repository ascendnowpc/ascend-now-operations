import { StudentScreen } from "./StudentScreen";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { useAssignedPcProfile } from "../../hooks/useAssignedPcProfile";
import { PcProfileWithEducation } from "../../components/pc/PcProfileCard";
import type { Student } from "../../types/database";

// "My PC" tab — the visual profile of the student's actively-assigned
// Performance Coach. Moved here off the Overview tab so it has a home of its
// own. Shows the card once the coach has a published profile; otherwise a
// short placeholder.
function MyPcView({ student }: { student: Student }) {
  const { assignedPc, loading } = useAssignedPcProfile(student.id);

  if (loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-navy-300 text-sm">
          <Spinner /> Loading…
        </div>
      </Card>
    );
  }

  if (!assignedPc) {
    return (
      <Card className="p-5">
        <p className="text-sm text-navy-400">
          No Performance Coach profile to show yet.
        </p>
      </Card>
    );
  }

  return <PcProfileWithEducation profile={assignedPc.profile} coachName={assignedPc.coachName} />;
}

export default function StudentMyPcPage() {
  return (
    <StudentScreen
      title="My PC"
      render={(student) => <MyPcView student={student} />}
    />
  );
}
