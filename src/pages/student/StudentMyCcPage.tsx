import { StudentScreen } from "./StudentScreen";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { useAssignedCcProfile } from "../../hooks/useAssignedCcProfile";
import { PcProfileWithEducation } from "../../components/pc/PcProfileCard";
import type { Student } from "../../types/database";

// "My CC" tab — the counsellor twin of My PC. Same card, same data table
// (`pc_profiles` backs both roles), with two differences: the timeline heading
// reads "College Counsellor", and the stock closing photo that ends a coach's
// card is left off. The tab itself only appears for a student who actually has
// a counsellor (see StudentLayout).
function MyCcView({ student }: { student: Student }) {
  const { assignedCc, loading } = useAssignedCcProfile(student.id);

  if (loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-navy-300 text-sm">
          <Spinner /> Loading…
        </div>
      </Card>
    );
  }

  if (!assignedCc?.profile) {
    return (
      <Card className="p-5">
        <p className="text-sm text-navy-400">
          No College Counsellor profile to show yet.
        </p>
      </Card>
    );
  }

  return (
    <PcProfileWithEducation
      profile={assignedCc.profile}
      coachName={assignedCc.counsellorName}
      roleTitle="College Counsellor"
      showClosingImage={false}
    />
  );
}

export default function StudentMyCcPage() {
  return (
    <StudentScreen
      title="My CC"
      render={(student) => <MyCcView student={student} />}
    />
  );
}
