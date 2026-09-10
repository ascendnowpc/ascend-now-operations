import { ParentChildScreen } from "./ParentChildScreen";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { useAssignedPcProfile } from "../../hooks/useAssignedPcProfile";
import { useAssignedCcProfile } from "../../hooks/useAssignedCcProfile";
import { PcProfileWithEducation } from "../../components/pc/PcProfileCard";
import type { Student } from "../../types/database";

// The child's Performance Coach card — the same visual profile the child sees
// on their own My PC tab. A parent reaches it through
// `parents_read_children_coach_pc_profile` (2026-09-10), which mirrors the
// student's own policy through the household link.
function CoachView({ student }: { student: Student }) {
  const { assignedPc, loading } = useAssignedPcProfile(student.id);

  if (loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      </Card>
    );
  }

  if (!assignedPc) {
    return (
      <Card className="p-5">
        <p className="text-sm text-navy-400">No Performance Coach profile to show yet.</p>
      </Card>
    );
  }

  return <PcProfileWithEducation profile={assignedPc.profile} coachName={assignedPc.coachName} />;
}

// The counsellor twin. The tab only appears for a child who actually has one
// (see ParentLayout), matching how the student's own sidebar behaves.
function CounsellorView({ student }: { student: Student }) {
  const { assignedCc, loading } = useAssignedCcProfile(student.id);

  if (loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      </Card>
    );
  }

  if (!assignedCc?.profile) {
    return (
      <Card className="p-5">
        <p className="text-sm text-navy-400">No College Counsellor profile to show yet.</p>
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

export function ParentChildCoachPage() {
  return <ParentChildScreen title="Coach" render={(student) => <CoachView student={student} />} />;
}

export function ParentChildCounsellorPage() {
  return <ParentChildScreen title="Counsellor" render={(student) => <CounsellorView student={student} />} />;
}
