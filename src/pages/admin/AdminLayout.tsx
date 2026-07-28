import type { ReactNode } from "react";
import { DashboardShell, type NavItem } from "../../components/layout/DashboardShell";
import { IconUsers, IconTeacher, IconClipboard, IconTag, IconPackage, IconBarChart, IconDownload, IconPlus, IconBell, IconCoordinatorLog, IconUser, IconGrid, IconSettings } from "../../components/ui/icons";

function IconLink() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// Book icon for Teacher Subjects and Subjects Library nav items
function IconBook() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const adminNavItems: NavItem[] = [
    { label: "Overview", to: "/admin/overview", icon: <IconGrid /> },
    {
      label: "Roles",
      icon: <IconUsers />,
      children: [
        { label: "Users", to: "/admin/users", icon: <IconUsers /> },
        { label: "Admins", to: "/admin/admins", icon: <IconUsers /> },
      ],
    },
    {
      label: "Students",
      icon: <IconUsers />,
      children: [
        { label: "Students", to: "/admin/students", icon: <IconUsers /> },
        { label: "Add / Renew Student", to: "/admin/students/enroll", icon: <IconPlus /> },
        { label: "Enrollments", to: "/admin/enrollments", icon: <IconClipboard /> },
        { label: "Learner's actual hours", to: "/admin/packages", icon: <IconPackage /> },
      ],
    },
    {
      label: "Teachers",
      icon: <IconTeacher />,
      children: [
        { label: "Teachers", to: "/admin/teachers", icon: <IconTeacher /> },
        { label: "Teacher Subjects", to: "/admin/teacher-subjects", icon: <IconBook /> },
        { label: "Teacher's Hours", to: "/admin/teacher-hours", icon: <IconBarChart /> },
        { label: "Zoom Invoices", to: "/admin/zoom-invoices", icon: <IconDownload /> },
      ],
    },
    {
      label: "Performance Coaches",
      icon: <IconTeacher />,
      children: [
        { label: "PC", to: "/admin/pcs", icon: <IconTeacher /> },
        { label: "PC Assignments", to: "/admin/pc-assignments", icon: <IconLink /> },
        { label: "PC's Log", to: "/admin/coordinator-logs", icon: <IconCoordinatorLog /> },
        { label: "PC Renewal Requests", to: "/admin/renewal-requests", icon: <IconBell /> },
      ],
    },
    { label: "Reports", to: "/admin/reports", icon: <IconBarChart /> },
    { label: "Analysis", to: "/admin/analysis", icon: <IconBarChart /> },
    {
      label: "Configuration",
      icon: <IconSettings />,
      children: [
        { label: "Settings", to: "/admin/settings", icon: <IconSettings /> },
        { label: "Program Types", to: "/admin/program-types", icon: <IconTag /> },
        { label: "Subjects", to: "/admin/subjects", icon: <IconBook /> },
      ],
    },
    { label: "Session Logs", to: "/admin/session-logs", icon: <IconClipboard /> },
    { label: "My Profile", to: "/admin/profile", icon: <IconUser /> },
  ];

  return (
    <DashboardShell navItems={adminNavItems} roleLabel="Admin">
      {children}
    </DashboardShell>
  );
}
