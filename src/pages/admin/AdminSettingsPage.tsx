import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { SettingsTab } from "./AdminReportsPage";

// Standalone "Settings" page (/admin/settings), under the sidebar's
// "Configuration" group. This used to be a sub-tab of the Reports page; the tab
// content (`SettingsTab`) is exported from there and reused here unchanged.
export default function AdminSettingsPage() {
  return (
    <AdminLayout>
      <PageHeader title="Settings" />
      <SettingsTab />
    </AdminLayout>
  );
}
