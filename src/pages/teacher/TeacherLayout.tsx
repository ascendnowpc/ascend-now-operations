import type { ReactNode } from "react";
import { DashboardShell, type NavItem } from "../../components/layout/DashboardShell";
import { IconUser, IconBook, IconClipboard, IconUsers, IconBarChart, IconDownload, IconPencil, IconBell, IconCoordinatorLog, IconNote, IconTeacher } from "../../components/ui/icons";
import { useAuth } from "../../context/AuthContext";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { teacherNeedsProfileCompletion } from "../../utils/profileCompletion";
import { TeacherCompleteProfileGate } from "../../components/portal/TeacherCompleteProfileGate";

export function TeacherLayout({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { teacher, loading, updateMyProfile } = useMyTeacherProfile();
  const isCoach = profile?.role === "performance_coach" || teacher?.is_performance_coach === true;
  const roleLabel = isCoach ? "Performance Coach" : "Teacher";

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

  const teacherNavItems: NavItem[] = isCoach
    ? [
        // Sectioned like the admin sidebar: shared tabs in one group, the
        // strictly-PC tabs in another, and My Profile standalone at the bottom.
        { label: "General", icon: <IconClipboard />, children: sharedNavItems },
        {
          label: "Performance Coach",
          icon: <IconTeacher />,
          children: [
            { label: "My Students", to: "/teacher/students", icon: <IconUsers /> },
            { label: "Students' Logs", to: "/teacher/student-logs", icon: <IconClipboard /> },
            { label: "Performance Coach Log", to: "/teacher/coordinator-logs", icon: <IconCoordinatorLog /> },
            { label: "Renewal Requests", to: "/teacher/renewal-requests", icon: <IconBell /> },
          ],
        },
        // "My Profile" for a coach covers their own account settings
        // (username/password, personal info) AND the public profile card
        // their assigned students see — merged from a separate "Coach
        // Profile" tab 2026-07-24, see PcProfilePage.tsx.
        { label: "My Profile", to: "/teacher/pc-profile", icon: <IconUser /> },
      ]
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
