import type { ReactNode } from "react";
import { DashboardShell, type NavItem } from "../../components/layout/DashboardShell";
import { IconUser, IconBook, IconClipboard, IconUsers, IconBarChart, IconDownload, IconPencil, IconBell, IconCoordinatorLog, IconNote, IconTeacher } from "../../components/ui/icons";
import { useAuth } from "../../context/AuthContext";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { teacherNeedsProfileCompletion } from "../../utils/profileCompletion";
import { TeacherCompleteProfileGate } from "../../components/portal/TeacherCompleteProfileGate";
import {
  coordinatorLogLabel,
  hasCoordinatorPanel,
  myStudentsPath,
  staffRoleFlags,
  staffRoleLabel,
} from "../../utils/staffRole";

export function TeacherLayout({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { teacher, loading, updateMyProfile } = useMyTeacherProfile();
  // A teacher may carry both flags even though users.role holds only one; PC
  // is the richer panel, so it wins the sidebar label. Rules in
  // src/utils/staffRole.ts so they're unit-testable (staffRole.test.ts).
  const { isCoach, isCounsellor } = staffRoleFlags(profile?.role, teacher);
  const roleLabel = staffRoleLabel({ isCoach, isCounsellor });

  // Mandatory first-login gate — admin never requires last name/email/phone/
  // country at add time (only first name is), so this is where they actually
  // get collected, blocking every other teacher route until filled in.
  // Mirrors StudentLayout.tsx's identical gate for students.
  if (!loading && teacher && teacherNeedsProfileCompletion(teacher)) {
    return <TeacherCompleteProfileGate teacher={teacher} updateMyProfile={updateMyProfile} />;
  }

  // Tabs shared by plain teachers and performance coaches. For a coach these
  // are grouped under a "General" section; for a plain teacher they stay a flat
  // list (see below).
  const sharedNavItems: NavItem[] = [
    { label: "Session Logging", to: "/teacher/sessions", icon: <IconClipboard /> },
    { label: "Homework Generator", to: "/teacher/homework", icon: <IconPencil /> },
    { label: "My Hours", to: "/teacher/hours", icon: <IconBarChart /> },
    { label: "My Subjects", to: "/teacher/subjects", icon: <IconBook /> },
    { label: "Notes", to: "/teacher/notes", icon: <IconNote /> },
  ];

  // A College Counsellor now sees everything a Performance Coach does, so the
  // two share this one sectioned panel — only the roster link and the section
  // label differ. Someone flagged as both gets both rosters.
  const coordinatorNavItems: NavItem[] = [
    // Sectioned like the admin sidebar: shared tabs in one group, the
    // coordinator tabs in another, and My Profile standalone at the bottom.
    { label: "General", icon: <IconClipboard />, children: sharedNavItems },
    {
      label: roleLabel,
      icon: <IconTeacher />,
      children: [
        { label: "My Students", to: myStudentsPath({ isCoach, isCounsellor }), icon: <IconUsers /> },
        ...(isCoach && isCounsellor
          ? [{ label: "My CC Students", to: "/teacher/cc-students", icon: <IconUsers /> }]
          : []),
        { label: "Students' Logs", to: "/teacher/student-logs", icon: <IconClipboard /> },
        { label: coordinatorLogLabel({ isCoach, isCounsellor }), to: "/teacher/coordinator-logs", icon: <IconCoordinatorLog /> },
      ],
    },
    // Standalone rather than inside the section above: coaches and counsellors
    // both file these now, so it isn't one role's tab any more.
    { label: "PC & CC Renewal Requests", to: "/teacher/renewal-requests", icon: <IconBell /> },
    // "My Profile" here covers their own account settings (username/password,
    // personal info) AND the public profile card their assigned students see
    // — merged from a separate "Coach Profile" tab 2026-07-24, see
    // PcProfilePage.tsx.
    { label: "My Profile", to: "/teacher/pc-profile", icon: <IconUser /> },
  ];

  const teacherNavItems: NavItem[] = hasCoordinatorPanel({ isCoach, isCounsellor })
    ? coordinatorNavItems
    : [
        ...sharedNavItems,
        // Zoom Invoice upload — plain teachers only, not performance coaches
        // (removed from the PC panel 2026-07-10).
        { label: "Invoices", to: "/teacher/invoices", icon: <IconDownload /> },
        // "My Profile" now covers what used to be a separate "Settings"
        // page too (username/password change) — merged 2026-07-05, see
        // TeacherProfilePage.tsx.
        { label: "My Profile", to: "/teacher/profile", icon: <IconUser /> },
      ];

  return (
    <DashboardShell navItems={teacherNavItems} roleLabel={roleLabel}>
      {children}
    </DashboardShell>
  );
}
