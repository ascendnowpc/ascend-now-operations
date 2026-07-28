import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import {
  IconUsers,
  IconTeacher,
  IconPlus,
  IconClipboard,
  IconPackage,
  IconBell,
  IconCoordinatorLog,
  IconBook,
  IconBarChart,
  IconDownload,
  IconSettings,
  IconTag,
} from "../../components/ui/icons";

// Matches the "PC Assignments" glyph used in the sidebar (AdminLayout).
function IconLink() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

interface OverviewLink {
  label: string;
  to: string;
  description: string;
  icon: ReactNode;
}

interface OverviewGroup {
  key: string;
  title: string;
  icon: ReactNode;
  // Tailwind accent classes for the tile's icon chip + open/hover states.
  iconChip: string;
  openTile: string;
  hoverTile: string;
  ring: string;
  links: OverviewLink[];
}

const GROUPS: OverviewGroup[] = [
  {
    key: "roles",
    title: "Roles",
    icon: <IconUsers />,
    iconChip: "bg-lime-100 text-lime-700",
    openTile: "border-lime-400 bg-lime-50/40",
    hoverTile: "hover:border-lime-300 hover:bg-lime-50/40",
    ring: "focus:ring-lime-300",
    links: [
      { label: "Users", to: "/admin/users", description: "Everyone who can log into the platform.", icon: <IconUsers /> },
      { label: "Admins", to: "/admin/admins", description: "Platform administrators.", icon: <IconUsers /> },
      { label: "Teachers & PC", to: "/admin/teachers", description: "Teachers and performance coaches.", icon: <IconTeacher /> },
    ],
  },
  {
    key: "students",
    title: "Students",
    icon: <IconUsers />,
    iconChip: "bg-sky-100 text-sky-700",
    openTile: "border-sky-400 bg-sky-50/40",
    hoverTile: "hover:border-sky-300 hover:bg-sky-50/40",
    ring: "focus:ring-sky-300",
    links: [
      { label: "Students", to: "/admin/students", description: "Every enrolled learner.", icon: <IconUsers /> },
      { label: "Add / Renew Student", to: "/admin/students/enroll", description: "Enrol a new student or renew a package.", icon: <IconPlus /> },
      { label: "Enrollments", to: "/admin/enrollments", description: "Review and confirm payment requests.", icon: <IconClipboard /> },
      { label: "Learner's actual hours", to: "/admin/packages", description: "Hour balances across all students.", icon: <IconPackage /> },
    ],
  },
  {
    key: "teachers",
    title: "Teachers",
    icon: <IconTeacher />,
    iconChip: "bg-green-100 text-green-700",
    openTile: "border-green-400 bg-green-50/40",
    hoverTile: "hover:border-green-300 hover:bg-green-50/40",
    ring: "focus:ring-green-300",
    links: [
      { label: "Teachers", to: "/admin/teachers", description: "Teachers on the platform (excludes PCs).", icon: <IconTeacher /> },
      { label: "Teacher Subjects", to: "/admin/teacher-subjects", description: "Teacher ↔ subject assignments.", icon: <IconBook /> },
      { label: "Teacher's Hours", to: "/admin/teacher-hours", description: "Hours and no-show payouts by month.", icon: <IconBarChart /> },
      { label: "Zoom Invoices", to: "/admin/zoom-invoices", description: "Teacher-uploaded Zoom invoices.", icon: <IconDownload /> },
    ],
  },
  {
    key: "pcs",
    title: "Performance Coaches",
    icon: <IconTeacher />,
    iconChip: "bg-orange-100 text-orange-700",
    openTile: "border-orange-400 bg-orange-50/40",
    hoverTile: "hover:border-orange-300 hover:bg-orange-50/40",
    ring: "focus:ring-orange-300",
    links: [
      { label: "PC", to: "/admin/pcs", description: "Performance coaches only.", icon: <IconTeacher /> },
      { label: "PC Assignments", to: "/admin/pc-assignments", description: "Assign coaches to students.", icon: <IconLink /> },
      { label: "PC's Log", to: "/admin/coordinator-logs", description: "Coaching check-in logs.", icon: <IconCoordinatorLog /> },
      { label: "PC Renewal Requests", to: "/admin/renewal-requests", description: "Renewals a coach flagged.", icon: <IconBell /> },
    ],
  },
  {
    key: "configuration",
    title: "Configuration",
    icon: <IconSettings />,
    iconChip: "bg-navy-100 text-navy-600",
    openTile: "border-navy-400 bg-navy-50/60",
    hoverTile: "hover:border-navy-300 hover:bg-navy-50/60",
    ring: "focus:ring-navy-300",
    links: [
      { label: "Settings", to: "/admin/settings", description: "No-show rules, bundle hours, log options.", icon: <IconSettings /> },
      { label: "Program Types", to: "/admin/program-types", description: "The program-type dropdown values.", icon: <IconTag /> },
      { label: "Subjects", to: "/admin/subjects", description: "The subject / curriculum catalogue.", icon: <IconBook /> },
    ],
  },
];

export default function AdminOverviewPage() {
  const navigate = useNavigate();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openGroup = GROUPS.find((g) => g.key === openKey) ?? null;

  return (
    <AdminLayout>
      <PageHeader title="Overview" description="Quick access to everything you manage." />

      {/* Compact top-level tiles — tap one to reveal its shortcuts below */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GROUPS.map((group) => {
          const open = group.key === openKey;
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => setOpenKey(open ? null : group.key)}
              aria-expanded={open}
              className={`text-left bg-white rounded-2xl border shadow-sm p-5 transition-colors focus:outline-none focus:ring-2 ${group.ring} ${
                open ? group.openTile : `border-navy-100 ${group.hoverTile}`
              }`}
            >
              <span className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${group.iconChip}`}>
                {group.icon}
              </span>
              <p className="font-semibold text-navy-700 text-lg mb-2">{group.title}</p>
              <p className="text-sm text-navy-400">
                {open ? "Tap to hide" : "Tap to open all"}
              </p>
            </button>
          );
        })}
      </div>

      {openGroup && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {openGroup.links.map((link) => (
            <button
              key={link.to}
              onClick={() => navigate(link.to)}
              className="flex items-center gap-3 rounded-xl border border-navy-100 bg-white p-4 text-left transition-colors hover:border-lime-300 hover:bg-lime-50/40 focus:outline-none focus:ring-2 focus:ring-lime-300"
            >
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-600">
                {link.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-navy-700">{link.label}</span>
                <span className="block text-xs text-navy-300">{link.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
