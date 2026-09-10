import type { ReactNode } from "react";
import { DashboardShell, type NavItem } from "../../components/layout/DashboardShell";
import {
  IconUsers,
  IconGrid,
  IconBarChart,
  IconClipboard,
  IconPencil,
  IconTeacher,
} from "../../components/ui/icons";
import { Spinner } from "../../components/ui/Spinner";
import { useHasAssignedCc } from "../../hooks/useAssignedCcProfile";
import type { Student } from "../../types/database";

/**
 * The parent portal shell.
 *
 * Unlike every other role, a parent's dashboard is never about one record —
 * it spans however many children are enrolled under the account. So the
 * sidebar has a permanent "My Children" entry, and the per-child tabs appear
 * beneath it as a group named after whichever child is currently open, with
 * that child's id in the URL. Switching child is just navigating to another
 * child's tab, and every page stays linkable and reloadable.
 */
export function ParentLayout({
  children,
  student,
  loading = false,
}: {
  children: ReactNode;
  /** The child currently being viewed, when the route is scoped to one. */
  student?: Student | null;
  loading?: boolean;
}) {
  // A CC is optional where a PC is the norm, so the counsellor tab only
  // appears once this child actually has one — same rule the student's own
  // sidebar follows.
  const { hasCc } = useHasAssignedCc(student?.id);

  const base = student ? `/parent/children/${student.id}` : null;

  const navItems: NavItem[] = [
    { label: "My Children", to: "/parent/children", icon: <IconUsers /> },
    ...(student && base
      ? [
          {
            label: `${student.first_name} ${student.last_name}`.trim(),
            icon: <IconUsers />,
            children: [
              { label: "Overview", to: base, icon: <IconGrid /> },
              { label: "Activity", to: `${base}/activity`, icon: <IconBarChart /> },
              { label: "Session Logs", to: `${base}/sessions`, icon: <IconClipboard /> },
              { label: "Homework", to: `${base}/homework`, icon: <IconPencil /> },
              { label: "Reports", to: `${base}/reports`, icon: <IconBarChart /> },
              { label: "Coach", to: `${base}/coach`, icon: <IconTeacher /> },
              ...(hasCc ? [{ label: "Counsellor", to: `${base}/counsellor`, icon: <IconTeacher /> }] : []),
            ],
          },
        ]
      : []),
    // Profile isn't a tab — it hangs off the sidebar footer's identity block,
    // the same as every other role.
  ];

  return (
    <DashboardShell navItems={navItems} roleLabel="Parent" profileTo="/parent/profile">
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
