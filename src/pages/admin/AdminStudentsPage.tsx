import { useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { Button } from "../../components/ui/Button";
import { IconPlus } from "../../components/ui/icons";
import { StudentsListView } from "../../components/students/StudentsListView";

// Thin wrapper — all the actual search/filter/table UI lives in the shared
// StudentsListView so the admin and PC "My Students" pages can never drift
// apart again. The admin sees every student (no allowedIds restriction) and
// gets the "Add / Renew Student" header action; there's no per-row remove
// action here — reassigning a student between PCs happens on
// /admin/pc-assignments instead.
export default function AdminStudentsPage() {
  const navigate = useNavigate();

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
      />
    </AdminLayout>
  );
}
