import type { NavItem } from "../../components/layout/DashboardShell";
import {
  IconUsers,
  IconTeacher,
  IconClipboard,
  IconTag,
  IconPackage,
  IconBarChart,
  IconDownload,
  IconPlus,
  IconBell,
  IconCoordinatorLog,
  IconUser,
  IconGrid,
  IconSettings,
  IconBook,
  IconLink,
} from "../../components/ui/icons";

/**
 * The admin sidebar, defined once. AdminLayout renders it as the sidebar and
 * AdminOverviewPage renders the same list as cards (via buildAdminOverview),
 * so the two can never drift apart.
 */
export const ADMIN_NAV_ITEMS: NavItem[] = [
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
      {
        label: "Teachers",
        to: "/admin/teachers",
        icon: <IconTeacher />,
        // /admin/teachers/new doubles as "add performance coach" via ?pc=1
        // and "add college counsellor" via ?cc=1 (see AdminPcsPage /
        // AdminCcsPage / AdminTeacherFormPage) — don't claim either here.
        isActive: (loc) => {
          const params = new URLSearchParams(loc.search);
          return (
            loc.pathname.startsWith("/admin/teachers") &&
            params.get("pc") !== "1" &&
            params.get("cc") !== "1"
          );
        },
      },
      { label: "Teacher Subjects", to: "/admin/teacher-subjects", icon: <IconBook /> },
      { label: "Teacher's Hours", to: "/admin/teacher-hours", icon: <IconBarChart /> },
      { label: "Zoom Invoices", to: "/admin/zoom-invoices", icon: <IconDownload /> },
    ],
  },
  {
    label: "Performance Coaches",
    icon: <IconTeacher />,
    children: [
      {
        label: "PC",
        to: "/admin/pcs",
        icon: <IconTeacher />,
        isActive: (loc) =>
          loc.pathname.startsWith("/admin/pcs") ||
          (loc.pathname === "/admin/teachers/new" && new URLSearchParams(loc.search).get("pc") === "1"),
      },
      { label: "PC Assignments", to: "/admin/pc-assignments", icon: <IconLink /> },
      { label: "PC's Log", to: "/admin/coordinator-logs", icon: <IconCoordinatorLog /> },
    ],
  },
  {
    label: "College Counsellors",
    icon: <IconTeacher />,
    children: [
      {
        label: "CC",
        to: "/admin/ccs",
        icon: <IconTeacher />,
        // /admin/teachers/new doubles as "add college counsellor" via ?cc=1,
        // the same way ?pc=1 works above — claim it here so the nav
        // highlights this section rather than Teachers.
        isActive: (loc) =>
          loc.pathname.startsWith("/admin/ccs") ||
          (loc.pathname === "/admin/teachers/new" && new URLSearchParams(loc.search).get("cc") === "1"),
      },
      { label: "CC Assignments", to: "/admin/cc-assignments", icon: <IconLink /> },
    ],
  },
  // Standalone rather than under Performance Coaches: counsellors file these
  // too now, so the queue belongs to neither role's section.
  { label: "Renewal Requests", to: "/admin/renewal-requests", icon: <IconBell /> },
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
