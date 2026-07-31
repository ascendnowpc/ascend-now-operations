import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { fetchTeacherById, deactivateTeacherById, useTeacherSubjects } from "../../hooks/useTeachers";
import { Spinner } from "../../components/ui/Spinner";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups, subjectDisplayLabel } from "../../hooks/useCurriculumGroups";
import type { Teacher } from "../../types/database";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-3 border-b border-navy-50 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-300">{label}</dt>
      <dd className="mt-1 text-navy-700">{value}</dd>
    </div>
  );
}

export default function AdminTeacherViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const { subjects: teacherSubjects, loading: subjectsLoading } = useTeacherSubjects(teacher?.id);
  const { subjects: allSubjects } = useSubjects();
  const { curricula } = useCurricula();
  const { groups: allGroups } = useAllCurriculumGroups();

  useEffect(() => {
    if (!id) return;
    fetchTeacherById(id).then(({ data, error }) => {
      if (error || !data) {
        setNotFound(true);
      } else {
        setTeacher(data);
      }
      setLoading(false);
    });
  }, [id]);

  function getSubjectLabel(subjectId: number, curriculumId: number | null) {
    const sub = allSubjects.find((s) => s.id === subjectId);
    const subLabel = sub ? subjectDisplayLabel(sub.name, sub.board, sub.subject_code, sub.level) : `Subject #${subjectId}`;
    const cur = curriculumId ? curricula.find((c) => c.id === curriculumId)?.name : null;
    const group = sub?.curriculum_group_id ? allGroups.find((g) => g.id === sub.curriculum_group_id)?.name : null;
    const parts = [cur, group, subLabel].filter(Boolean);
    return parts.join(" | ");
  }

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      </AdminLayout>
    );
  }

  if (notFound || !teacher) {
    return (
      <AdminLayout>
        <PageHeader title="Teacher not found" />
        <p className="text-navy-300">
          We couldn't find a teacher with this ID.{" "}
          <Link to="/admin/teachers" className="text-sky-400 underline">
            Back to teachers
          </Link>
        </p>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <PageHeader
        title={`${teacher.first_name} ${teacher.last_name ?? ""}`.trim()}
        description="Full teacher record — every field on file."
        action={
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => navigate("/admin/teachers")}>
              Back
            </Button>
            <Button onClick={() => navigate(`/admin/teachers/${teacher.id}/edit`)}>Edit</Button>
            {teacher.is_active && (
              <Button variant="secondary" onClick={() => { setDeactivateError(null); setConfirmDeactivate(true); }}>
                Deactivate
              </Button>
            )}
          </div>
        }
      />

      {deactivateError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{deactivateError}</p>
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        title="Deactivate this teacher?"
        description={`${teacher.first_name} ${teacher.last_name ?? ""} will be marked inactive and will no longer be able to log in.`}
        confirmLabel={deactivating ? "Deactivating…" : "Deactivate"}
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={async () => {
          setDeactivating(true);
          const { error } = await deactivateTeacherById(teacher);
          setDeactivating(false);
          setConfirmDeactivate(false);
          if (error) { setDeactivateError(error); return; }
          setTeacher((prev) => prev ? { ...prev, is_active: false } : null);
        }}
      />

      {/* Scrollable card so the full record is always reachable,
          per the requirement that nothing gets cut off or hidden. */}
      <Card className="p-6 max-h-[70vh] overflow-y-auto">
        <dl>
          <Field label="ID" value={teacher.id} />
          <Field
            label="Status"
            value={
              teacher.is_active ? (
                <span className="inline-block rounded-pill bg-lime-100 text-lime-600 px-3 py-0.5 text-xs font-semibold">Active</span>
              ) : (
                <span className="inline-block rounded-pill bg-navy-50 text-navy-300 px-3 py-0.5 text-xs font-semibold">Inactive</span>
              )
            }
          />
          <Field label="First name" value={teacher.first_name} />
          <Field label="Last name" value={teacher.last_name ?? "—"} />
          <Field label="Country" value={teacher.country ?? "—"} />
          <Field label="Email" value={teacher.email ?? "—"} />
          <Field label="Phone number" value={teacher.phone_number ?? "—"} />
          <Field
            label="Performance coach"
            value={teacher.is_performance_coach ? "Yes" : "No"}
          />
          <Field
            label="College counsellor"
            value={teacher.is_college_counselor ? "Yes" : "No"}
          />
          <Field label="Linked user account ID" value={teacher.user_id ?? "Not linked yet"} />
          <Field
            label="Subjects"
            value={
              subjectsLoading ? (
                <Spinner size={16} />
              ) : teacherSubjects.length === 0 ? (
                "No subjects on file."
              ) : (
                <div className="flex flex-wrap gap-2">
                  {teacherSubjects.map((s) => (
                    <span
                      key={s.id}
                      className="inline-block rounded-pill bg-navy-50 text-navy-600 px-3 py-1 text-sm"
                    >
                      {getSubjectLabel(s.subject_id, s.curriculum_id)}
                    </span>
                  ))}
                </div>
              )
            }
          />
          <Field label="Created at" value={new Date(teacher.created_at).toLocaleString()} />
          <Field label="Last updated" value={new Date(teacher.updated_at).toLocaleString()} />
        </dl>
      </Card>
    </AdminLayout>
  );
}
