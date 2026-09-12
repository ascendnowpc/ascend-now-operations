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
// One header action: "+ Add student" (/admin/students/new), which creates the
// student and their login and emails them the credentials — the same shape as
// adding a teacher or an admin. Hours are a separate job on a separate form
// (/admin/packages/new), because a package belongs to a student who already
// exists and can just as easily be a second package for one who does.
export default function AdminStudentsPage() {
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;

  return (
    <AdminLayout>
      <StudentsListView
        title="Students"
        description="All registered students. Click a student to view details and edit."
        headerAction={
          <Button className="flex items-center gap-2" onClick={() => navigate("/admin/students/new")}>
            <IconPlus /> Add student
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
