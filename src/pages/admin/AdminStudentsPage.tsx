import { useLocation, useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { Button } from "../../components/ui/Button";
import { IconPlus } from "../../components/ui/icons";
import { StudentsListView } from "../../components/students/StudentsListView";

// Thin wrapper — all the actual search/filter/table UI lives in the shared
// StudentsListView so the admin and PC "My Students" pages can never drift
// apart again. The admin sees every student (no allowedIds restriction); there's
// no per-row remove action here — reassigning a student between PCs happens on
// /admin/pc-assignments instead.
//
// One header action, and one way in: /admin/students/enroll. A second,
// package-less "Add student" form existed alongside it until 2026-09-12 and was
// removed — two forms that both created a student, only one of which could give
// them any hours, is the kind of inconsistency nobody could keep straight.
export default function AdminStudentsPage() {
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;

  return (
    <AdminLayout>
      <StudentsListView
        title="Students"
        description="All registered students. Click a student to view details and edit."
        headerAction={
          <Button className="flex items-center gap-2" onClick={() => navigate("/admin/students/enroll")}>
            <IconPlus /> Add / Renew Student
          </Button>
        }
        detailPath={(id) => `/admin/students/${id}`}
      >
        {notice && (
          <p className="text-sm text-lime-700 bg-lime-50 border border-lime-100 rounded-lg px-3 py-2 mb-4">
            {notice}
          </p>
        )}
      </StudentsListView>
    </AdminLayout>
  );
}
