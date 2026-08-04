import type { ReactNode } from "react";
import { DashboardShell } from "../../components/layout/DashboardShell";
import { ADMIN_NAV_ITEMS } from "./adminNav";
import { useMyAdminProfile } from "../../hooks/useMyAdminProfile";
import { adminNeedsProfileCompletion } from "../../utils/profileCompletion";
import { AdminCompleteProfileGate } from "../../components/portal/AdminCompleteProfileGate";

export function AdminLayout({ children }: { children: ReactNode }) {
  const { admin, loading, updateMyProfile } = useMyAdminProfile();

  // Mandatory first-login gate — an admin's phone and country are never
  // captured when another admin creates the account, so this is where they
  // get collected, blocking every other admin route until filled in. Mirrors
  // the identical gates in TeacherLayout.tsx / StudentLayout.tsx.
  if (!loading && admin && adminNeedsProfileCompletion(admin)) {
    return <AdminCompleteProfileGate admin={admin} updateMyProfile={updateMyProfile} />;
  }

  // Sidebar lives in adminNav.tsx so AdminOverviewPage can render the exact
  // same list as cards.
  return (
    <DashboardShell navItems={ADMIN_NAV_ITEMS} roleLabel="Admin" profileTo="/admin/profile">
      {children}
    </DashboardShell>
  );
}
