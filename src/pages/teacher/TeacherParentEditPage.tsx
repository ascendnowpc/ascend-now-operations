import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ParentEditForm } from "../../components/parents/ParentEditForm";
import { useParents } from "../../hooks/useParents";
import { parentDisplayName } from "../../utils/parentDirectory";
import type { Parent } from "../../types/database";

/**
 * A coach editing one of their students' households (/teacher/parents/:id/edit).
 *
 * The coach counterpart of /admin/parents/:id/edit, sharing its form so the
 * two can never ask for different fields. There is no coach-facing parents
 * LIST — a coach reaches this only from a student they coach, and `?returnTo=`
 * carries them back to that student's page on save or cancel.
 *
 * RLS is the real gate: `staff_update_assigned_parents` (2026-09-17) allows
 * the write only for a household with a child on this coach's own roster, so
 * a hand-typed id in the address bar saves nothing.
 */
export default function TeacherParentEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "/teacher/students";

  const { parents, loading, updateParent } = useParents();
  const existing: Parent | null = parents.find((p) => p.id === id) ?? null;

  async function handleSave(fields: {
    first_name: string;
    last_name: string;
    email: string | null;
    phone_number: string | null;
    country: string | null;
    profession: string | null;
  }) {
    if (!existing) return { error: "That parent no longer exists." };
    const { error } = await updateParent(existing.id, fields);
    if (error) return { error };
    navigate(returnTo, {
      state: { notice: `Updated ${fields.first_name} ${fields.last_name}'s details.` },
    });
    return { error: null };
  }

  return (
    <TeacherLayout>
      <PageHeader title={existing ? `Edit ${parentDisplayName(existing)}` : "Edit parent"} />

      {loading && !existing && (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      )}

      {!loading && !existing && (
        <Card className="p-6 max-w-2xl">
          <p className="text-sm text-navy-500">That parent no longer exists.</p>
          <Button className="mt-4" variant="ghost" onClick={() => navigate(returnTo)}>
            Back
          </Button>
        </Card>
      )}

      {existing && (
        <ParentEditForm
          parent={existing}
          onSave={handleSave}
          onCancel={() => navigate(returnTo)}
        />
      )}
    </TeacherLayout>
  );
}
