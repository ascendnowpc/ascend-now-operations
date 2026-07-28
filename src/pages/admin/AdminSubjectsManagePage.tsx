import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { SubjectsLibraryContent } from "../../components/subjects/SubjectsLibraryContent";

export default function AdminSubjectsManagePage() {
  return (
    <AdminLayout>
      <PageHeader
        title="Subjects & Curricula"
        description="Manage the global list of curricula and subjects used across the app."
      />
      <SubjectsLibraryContent />
    </AdminLayout>
  );
}
