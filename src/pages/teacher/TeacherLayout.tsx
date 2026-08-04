import type { ReactNode } from "react";
import { DashboardShell, type NavItem } from "../../components/layout/DashboardShell";
import { IconBook, IconClipboard, IconUsers, IconBarChart, IconDownload, IconPencil, IconBell, IconCoordinatorLog, IconNote, IconTeacher } from "../../components/ui/icons";
import { useAuth } from "../../context/AuthContext";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { teacherNeedsProfileCompletion } from "../../utils/profileCompletion";
import { TeacherCompleteProfileGate } from "../../components/portal/TeacherCompleteProfileGate";
import { hasCoordinatorPanel, staffProfilePath, staffRoleFlags, staffRoleLabel } from "../../utils/staffRole";

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

  // A College Counsellor sees exactly what a Performance Coach sees — same
  // tabs, same pages, same single log. The section is named after whichever
  // hat the person wears, but that's the only thing that changes: the tabs
  // inside it are identical, and "Performance Coach Log" keeps its name for
  // both because there is one coordinator log, not one per role. Their
  // rosters differ, but that's handled inside the pages (both read the PC and
  // CC assignment tables and show the union), not by giving a counsellor
  // different navigation.
  const coordinatorNavItems: NavItem[] = [
    // Sectioned like the admin sidebar: shared tabs in one group, the
    // coordinator tabs in another, and My Profile standalone at the bottom.
    { label: "General", icon: <IconClipboard />, children: sharedNavItems },
    {
      label: roleLabel,
      icon: <IconTeacher />,
      children: [
        { label: "My Students", to: "/teacher/students", icon: <IconUsers /> },
        { label: "Students' Logs", to: "/teacher/student-logs", icon: <IconClipboard /> },
        { label: "Performance Coach Log", to: "/teacher/coordinator-logs", icon: <IconCoordinatorLog /> },
      ],
    },
    // Standalone rather than inside the section above: coaches and counsellors
    // both file these now, so it isn't one role's tab any more.
    { label: "Renewal Requests", to: "/teacher/renewal-requests", icon: <IconBell /> },
  ];

  const teacherNavItems: NavItem[] = hasCoordinatorPanel({ isCoach, isCounsellor })
    ? coordinatorNavItems
    : [
        ...sharedNavItems,
        // Zoom Invoice upload — plain teachers only, not performance coaches
        // (removed from the PC panel 2026-07-10).
        { label: "Invoices", to: "/teacher/invoices", icon: <IconDownload /> },
      ];

  // Neither sidebar carries a "My Profile" tab any more — the profile page is
  // reached from the footer's name/email link and Profile button. Which page
  // that is still depends on the panel shape: a coach/counsellor's merged
  // /teacher/pc-profile (personal info + account settings + their read-only
  // public card, PcProfilePage.tsx) vs a plain teacher's /teacher/profile
  // (personal info + account settings, TeacherProfilePage.tsx).
  return (
    <DashboardShell
      navItems={teacherNavItems}
      roleLabel={roleLabel}
      profileTo={staffProfilePath({ isCoach, isCounsellor })}
    >
      {children}
    </DashboardShell>
  );
}
