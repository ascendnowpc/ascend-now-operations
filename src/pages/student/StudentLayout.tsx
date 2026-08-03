import type { ReactNode } from "react";
import { DashboardShell } from "../../components/layout/DashboardShell";
import { IconGrid, IconPackage, IconBarChart, IconClipboard, IconUser, IconPencil, IconTeacher } from "../../components/ui/icons";
import { Spinner } from "../../components/ui/Spinner";
import { useMyStudent } from "../../hooks/useMyStudent";
import { useHasAssignedCc } from "../../hooks/useAssignedCcProfile";
import { studentNeedsProfileCompletion } from "../../utils/profileCompletion";
import { StudentCompleteProfileGate } from "../../components/portal/StudentCompleteProfileGate";

export function StudentLayout({ children }: { children: ReactNode }) {
  const { student, loading, updateMyProfile } = useMyStudent();
  // A CC is optional where a PC is the norm, so My CC only appears once the
  // student actually has one — unlike My PC, which is always there.
  const { hasCc } = useHasAssignedCc(student?.id);
  const navItems = [
    { label: "Overview", to: "/student/overview", icon: <IconGrid /> },
    { label: "Package Status", to: "/student/packages", icon: <IconPackage /> },
    { label: "Reports", to: "/student/reports", icon: <IconBarChart /> },
    { label: "Session Logs", to: "/student/sessions", icon: <IconClipboard /> },
    { label: "My Homework", to: "/student/homework", icon: <IconPencil /> },
    { label: "My PC", to: "/student/my-pc", icon: <IconTeacher /> },
    ...(hasCc ? [{ label: "My CC", to: "/student/my-cc", icon: <IconTeacher /> }] : []),
    { label: "Profile", to: "/student/profile", icon: <IconUser /> },
  ];

  // Mandatory first-login gate — admin never requires phone/graduation
  // year/birthday/school at enrollment time, so this is where they actually
  // get collected, blocking every other student route until filled in.
  // Only takes over once loading settles — while loading, the shell (and its
  // sidebar) stays mounted the same as the loaded case below, so it doesn't
  // flash away and back on every nav click (each student page re-mounts this
  // layout, re-running the fetch — see useMyStudent's own cache for the rest
  // of the fix).
  if (!loading && student && studentNeedsProfileCompletion(student)) {
    return <StudentCompleteProfileGate student={student} updateMyProfile={updateMyProfile} />;
  }

  return (
    <DashboardShell navItems={navItems} roleLabel="Student">
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={32} />
        </div>
      ) : (
        children
      )}
    </DashboardShell>
  );
}
