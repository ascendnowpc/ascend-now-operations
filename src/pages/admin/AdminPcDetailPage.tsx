import { useEffect, useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { IconArrowLeft } from "../../components/ui/icons";
import { StudentsListView } from "../../components/students/StudentsListView";
import { PcAssignmentReport } from "../../components/pc/PcAssignmentReport";
import { PcProfileWithEducation } from "../../components/pc/PcProfileCard";
import { PcProfileEditor } from "../../components/pc/PcProfileEditor";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { usePcProfile } from "../../hooks/usePcProfile";
import { fetchTeacherById, deactivateTeacherById, useTeacherSubjects } from "../../hooks/useTeachers";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups, subjectDisplayLabel } from "../../hooks/useCurriculumGroups";
import type { Teacher } from "../../types/database";

type Tab = "details" | "students" | "report" | "profile";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-3 border-b border-navy-50 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-300">{label}</dt>
      <dd className="mt-1 text-navy-700">{value}</dd>
    </div>
  );
}

// PC detail view opened from the PC list (/admin/pcs/:id). Three horizontal
// tabs, mirroring the students area: "Details" is this coach's full record
// (with Edit/Deactivate), "Students" reuses the shared StudentsListView scoped
// to this coach's assigned students, and "Report" reuses the same
// PcAssignmentReport aggregate the PC Assignments page shows. This is
// intentionally NOT the PC Assignments page — no assign/unassign here.
export default function AdminPcDetailPage() {
  const { id } = useParams<{ id: string }>();
  const pcId = id!;
  const navigate = useNavigate();
  const { activeAssignments, loading: loadingAssignments } = usePcAssignments();
  const [pc, setPc] = useState<Teacher | null>(null);
  const [loadingPc, setLoadingPc] = useState(true);
  const [tab, setTab] = useState<Tab>("details");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const { subjects: teacherSubjects, loading: subjectsLoading } = useTeacherSubjects(pc?.id);
  const { subjects: allSubjects } = useSubjects();
  const { curricula } = useCurricula();
  const { groups: allGroups } = useAllCurriculumGroups();

  useEffect(() => {
    if (!id) return;
    setLoadingPc(true);
    fetchTeacherById(id).then(({ data }) => {
      setPc(data ?? null);
      setLoadingPc(false);
    });
  }, [id]);

  function getSubjectLabel(subjectId: number, curriculumId: number | null) {
    const sub = allSubjects.find((s) => s.id === subjectId);
    const subLabel = sub ? subjectDisplayLabel(sub.name, sub.board, sub.subject_code, sub.level) : `Subject #${subjectId}`;
    const cur = curriculumId ? curricula.find((c) => c.id === curriculumId)?.name : null;
    const group = sub?.curriculum_group_id ? allGroups.find((g) => g.id === sub.curriculum_group_id)?.name : null;
    return [cur, group, subLabel].filter(Boolean).join(" | ");
  }

  const assignedIds = new Set(
    activeAssignments.filter((a) => a.pc_teacher_id === pcId).map((a) => a.student_id)
  );

  if (loadingPc || loadingAssignments) {
    return (
      <AdminLayout>
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      </AdminLayout>
    );
  }

  if (!pc) {
    return (
      <AdminLayout>
        <button
          onClick={() => navigate("/admin/pcs")}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-500 hover:text-sky-600 mb-4"
        >
          <IconArrowLeft /> Back to PC list
        </button>
        <p className="text-sm text-navy-400">Performance coach not found.</p>
      </AdminLayout>
    );
  }

  const pcName = `${pc.first_name} ${pc.last_name ?? ""}`.trim();
  const tabs: [Tab, string][] = [
    ["details", "Details"],
    ["students", "Students"],
    ["report", "Report"],
    ["profile", "Profile"],
  ];

  return (
    <AdminLayout>
      <button
        onClick={() => navigate("/admin/pcs")}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-500 hover:text-sky-600 mb-4"
      >
        <IconArrowLeft /> Back to PC list
      </button>

      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-navy-700 sm:text-2xl">{pcName}</h1>
          <p className="text-navy-300 mt-0.5 text-sm">Performance Coach — details, assigned students and report.</p>
        </div>
        <div className="flex flex-shrink-0 gap-3">
          <Button onClick={() => navigate(`/admin/teachers/${pc.id}/edit`)}>Edit</Button>
          {pc.is_active && (
            <Button variant="secondary" onClick={() => { setDeactivateError(null); setConfirmDeactivate(true); }}>
              Deactivate
            </Button>
          )}
        </div>
      </div>

      {deactivateError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{deactivateError}</p>
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        title="Deactivate this performance coach?"
        description={`${pcName} will be marked inactive and will no longer be able to log in.`}
        confirmLabel={deactivating ? "Deactivating…" : "Deactivate"}
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={async () => {
          setDeactivating(true);
          const { error } = await deactivateTeacherById(pc);
          setDeactivating(false);
          setConfirmDeactivate(false);
          if (error) { setDeactivateError(error); return; }
          setPc((prev) => (prev ? { ...prev, is_active: false } : null));
        }}
      />

      {/* Tabs */}
      <div className="flex gap-0 border-b border-navy-100 mb-6">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-sky-500 text-sky-600"
                : "border-transparent text-navy-400 hover:text-navy-600 hover:border-navy-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "details" && (
        <Card className="p-6 max-h-[70vh] overflow-y-auto max-w-3xl">
          <dl>
            <Field label="ID" value={pc.id} />
            <Field
              label="Status"
              value={
                pc.is_active ? (
                  <span className="inline-block rounded-pill bg-lime-100 text-lime-600 px-3 py-0.5 text-xs font-semibold">Active</span>
                ) : (
                  <span className="inline-block rounded-pill bg-navy-50 text-navy-300 px-3 py-0.5 text-xs font-semibold">Inactive</span>
                )
              }
            />
            <Field label="First name" value={pc.first_name} />
            <Field label="Last name" value={pc.last_name ?? "—"} />
            <Field label="Country" value={pc.country ?? "—"} />
            <Field label="Email" value={pc.email ?? "—"} />
            <Field label="Phone number" value={pc.phone_number ?? "—"} />
            <Field label="Performance coach" value={pc.is_performance_coach ? "Yes" : "No"} />
            <Field label="Linked user account ID" value={pc.user_id ?? "Not linked yet"} />
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
                      <span key={s.id} className="inline-block rounded-pill bg-navy-50 text-navy-600 px-3 py-1 text-sm">
                        {getSubjectLabel(s.subject_id, s.curriculum_id)}
                      </span>
                    ))}
                  </div>
                )
              }
            />
            <Field label="Created at" value={new Date(pc.created_at).toLocaleString()} />
            <Field label="Last updated" value={new Date(pc.updated_at).toLocaleString()} />
          </dl>
        </Card>
      )}

      {tab === "students" && (
        <StudentsListView
          title="Assigned students"
          description={`Students assigned to ${pcName} as their Performance Coach.`}
          allowedIds={assignedIds}
          detailPath={(sid) => `/admin/students/${sid}`}
          emptyMessage="No students are assigned to this coach yet."
        />
      )}

      {tab === "report" && (
        <Card className="p-5">
          <PcAssignmentReport studentIds={[...assignedIds]} expanded={true} />
        </Card>
      )}

      {tab === "profile" && <ProfileTab pcId={pc.id} coachName={pcName} />}
    </AdminLayout>
  );
}

// The coach's visual profile — created and maintained here by the admin (the
// coach's own /teacher/pc-profile page is read-only). Shows the card with an
// Edit button, or the full editor. Reuses the same PcProfileEditor/PcProfileCard
// the rest of the app uses; usePcProfile keyed on the coach's teacher id lets
// an admin upsert any coach's row (RLS: is_admin() → ALL).
function ProfileTab({ pcId, coachName }: { pcId: string; coachName: string }) {
  const { profile, loading, uploadPhoto, save } = usePcProfile(pcId);
  const [editing, setEditing] = useState(false);
  const hasProfile = !!profile && profile.is_published;

  if (loading) {
    return <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>;
  }

  if (editing) {
    return (
      <PcProfileEditor
        profile={profile}
        coachName={coachName}
        uploadPhoto={uploadPhoto}
        save={save}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  if (hasProfile) {
    return (
      <div className="flex flex-col gap-4">
        <div className="max-w-3xl mx-auto w-full flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Edit profile
          </Button>
        </div>
        <PcProfileWithEducation profile={profile!} coachName={coachName} />
      </div>
    );
  }

  return (
    <Card className="p-8 max-w-xl text-center">
      <p className="text-navy-700 font-semibold text-lg">Set up this coach's profile</p>
      <p className="text-sm text-navy-400 mt-1 mb-5">
        Introduce them, share their achievements — their assigned students will see this on their My PC tab.
      </p>
      <Button onClick={() => setEditing(true)}>Get started</Button>
    </Card>
  );
}
