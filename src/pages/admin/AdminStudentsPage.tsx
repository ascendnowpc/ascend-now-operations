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
// Two header actions, because there are two genuinely different jobs:
//   * Add student — creates the student and their login there and then
//     (/admin/students/new), the way every other role is added.
//   * Add / Renew — the invoice → payment link → proof → confirm flow
//     (/admin/students/enroll), for when money is actually changing hands.
export default function AdminStudentsPage() {
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;

  return (
    <AdminLayout>
      <StudentsListView
        title="Students"
        description="All registered students. Click a student to view details and edit."
        headerAction={
          <div className="flex gap-2">
            <Button className="flex items-center gap-2" onClick={() => navigate("/admin/students/new")}>
              <IconPlus /> Add student
            </Button>
            <Button variant="ghost" onClick={() => navigate("/admin/students/enroll")}>
              Add / Renew
            </Button>
          </div>
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
