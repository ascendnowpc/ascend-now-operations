import type { ReactNode } from "react";
import { DashboardShell, type NavItem } from "../../components/layout/DashboardShell";
import {
  IconUsers,
  IconGrid,
  IconBarChart,
  IconClipboard,
  IconPencil,
  IconTeacher,
  IconUser,
} from "../../components/ui/icons";
import { Spinner } from "../../components/ui/Spinner";
import { useHasAssignedCc } from "../../hooks/useAssignedCcProfile";
import { useAuth } from "../../context/AuthContext";
import { useMyParent } from "../../hooks/useParents";
import { parentNeedsProfileCompletion } from "../../utils/profileCompletion";
import { ParentCompleteProfileGate } from "../../components/portal/ParentCompleteProfileGate";
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
  // Resolved here rather than passed in, because the gate below has to cover
  // every parent route including the ones that never look at the parent row
  // themselves. Cached by useMyParent, so this costs nothing per navigation.
  const { session } = useAuth();
  const { parent, loading: parentLoading, updateMyParent } = useMyParent(session?.user?.id);

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
              { label: "Details", to: `${base}/details`, icon: <IconUser /> },
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

  // Mandatory first-login gate — an admin creates a parent account from a
  // name and an email, so country/profession have nowhere else to come from.
  // Gated on `!parentLoading` for the same reason the student's is: each
  // parent page re-mounts this layout, and a flash of the gate between
  // navigations would be worse than a moment of the shell.
  if (!parentLoading && parent && parentNeedsProfileCompletion(parent)) {
    return <ParentCompleteProfileGate parent={parent} updateMyParent={updateMyParent} />;
  }

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
