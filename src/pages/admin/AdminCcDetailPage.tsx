import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { IconArrowLeft } from "../../components/ui/icons";
import { StudentsListView } from "../../components/students/StudentsListView";
import { PcProfileWithEducation } from "../../components/pc/PcProfileCard";
import { PcProfileEditor } from "../../components/pc/PcProfileEditor";
import { useCcAssignments } from "../../hooks/useCcAssignments";
import { usePcProfile } from "../../hooks/usePcProfile";
import { useStudents } from "../../hooks/useStudents";
import { fetchTeacherById, deactivateTeacherById } from "../../hooks/useTeachers";
import { myRosterStudentIds } from "../../utils/staffRoster";
import type { Teacher } from "../../types/database";

type Tab = "details" | "students" | "profile";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-3 border-b border-navy-50 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-300">{label}</dt>
      <dd className="mt-1 text-navy-700">{value}</dd>
    </div>
  );
}

// CC detail view opened from the CC list (/admin/ccs/:id) — the counsellor
// counterpart of AdminPcDetailPage, and deliberately the same shape: "Students"
// is the shared StudentsListView scoped to this counsellor's students (a row
// opens the full student record), and "Profile" is where the admin writes the
// card the counsellor's students see on My CC. There's no Report tab:
// PcAssignmentReport is built on pc_student_assignments.
export default function AdminCcDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ccId = id!;
  const navigate = useNavigate();
  const { assignments, loading: loadingAssignments } = useCcAssignments();
  const { students } = useStudents();
  const [cc, setCc] = useState<Teacher | null>(null);
  const [loadingCc, setLoadingCc] = useState(true);
  const [tab, setTab] = useState<Tab>("details");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoadingCc(true);
    fetchTeacherById(id).then(({ data }) => {
      setCc(data ?? null);
      setLoadingCc(false);
    });
  }, [id]);

  // Same rule as the counsellor's own My Students page: live engagements plus
  // the students they completed, who are unassigned by then but still belong
  // to whoever saw them through.
  const { visible: studentIdsForCc } = useMemo(
    () =>
      myRosterStudentIds({
        teacherId: ccId,
        isCoach: false,
        isCounsellor: true,
        pcAssignments: [],
        ccAssignments: assignments,
        students,
      }),
    [assignments, students, ccId]
  );

  if (loadingCc || loadingAssignments) {
    return (
      <AdminLayout>
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      </AdminLayout>
    );
  }

  if (!cc) {
    return (
      <AdminLayout>
        <button
          onClick={() => navigate("/admin/ccs")}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-500 hover:text-sky-600 mb-4"
        >
          <IconArrowLeft /> Back to CC list
        </button>
        <p className="text-sm text-navy-400">College counsellor not found.</p>
      </AdminLayout>
    );
  }

  const ccName = `${cc.first_name} ${cc.last_name ?? ""}`.trim();
  const tabs: [Tab, string][] = [
    ["details", "Details"],
    ["students", "Students"],
    ["profile", "Profile"],
  ];

  return (
    <AdminLayout>
      <button
        onClick={() => navigate("/admin/ccs")}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-500 hover:text-sky-600 mb-4"
      >
        <IconArrowLeft /> Back to CC list
      </button>

      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-navy-700 sm:text-2xl">{ccName}</h1>
          <p className="text-navy-300 mt-0.5 text-sm">College Counsellor — details, assigned students and profile.</p>
        </div>
        <div className="flex flex-shrink-0 gap-3">
          <Button onClick={() => navigate(`/admin/teachers/${cc.id}/edit`)}>Edit</Button>
          {cc.is_active && (
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
        title="Deactivate this college counsellor?"
        description={`${ccName} will be marked inactive and will no longer be able to log in.`}
        confirmLabel={deactivating ? "Deactivating…" : "Deactivate"}
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={async () => {
          setDeactivating(true);
          const { error } = await deactivateTeacherById(cc);
          setDeactivating(false);
          setConfirmDeactivate(false);
          if (error) { setDeactivateError(error); return; }
          setCc((prev) => (prev ? { ...prev, is_active: false } : null));
        }}
      />

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
            <Field label="ID" value={cc.id} />
            <Field
              label="Status"
              value={
                cc.is_active ? (
                  <span className="inline-block rounded-pill bg-lime-100 text-lime-600 px-3 py-0.5 text-xs font-semibold">Active</span>
                ) : (
                  <span className="inline-block rounded-pill bg-navy-50 text-navy-300 px-3 py-0.5 text-xs font-semibold">Inactive</span>
                )
              }
            />
            <Field label="First name" value={cc.first_name} />
            <Field label="Last name" value={cc.last_name ?? "—"} />
            <Field label="Country" value={cc.country ?? "—"} />
            <Field label="Email" value={cc.email ?? "—"} />
            <Field label="Phone number" value={cc.phone_number ?? "—"} />
            <Field label="College counsellor" value={cc.is_college_counselor ? "Yes" : "No"} />
            <Field label="Performance coach" value={cc.is_performance_coach ? "Yes" : "No"} />
            <Field label="Linked user account ID" value={cc.user_id ?? "Not linked yet"} />
            <Field label="Created at" value={new Date(cc.created_at).toLocaleString()} />
            <Field label="Last updated" value={new Date(cc.updated_at).toLocaleString()} />
          </dl>
        </Card>
      )}

      {tab === "students" && (
        <StudentsListView
          title="Assigned students"
          description={`Students assigned to ${ccName} as their College Counsellor.`}
          allowedIds={studentIdsForCc}
          detailPath={(sid) => `/admin/students/${sid}`}
          emptyMessage="No students are assigned to this counsellor yet."
        />
      )}

      {tab === "profile" && <ProfileTab ccId={cc.id} counsellorName={ccName} />}
    </AdminLayout>
  );
}

// The counsellor's visual profile — the same `pc_profiles` row type and the
// same editor a coach's card uses (one table backs both roles), maintained
// here by the admin. The card preview drops the coach's stock closing photo,
// matching what the student sees on their My CC tab.
function ProfileTab({ ccId, counsellorName }: { ccId: string; counsellorName: string }) {
  const { profile, loading, uploadPhoto, save } = usePcProfile(ccId);
  const [editing, setEditing] = useState(false);
  const hasProfile = !!profile && profile.is_published;

  if (loading) {
    return <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>;
  }

  if (editing) {
    return (
      <PcProfileEditor
        profile={profile}
        coachName={counsellorName}
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
        <PcProfileWithEducation
          profile={profile!}
          coachName={counsellorName}
          roleTitle="College Counsellor"
          showClosingImage={false}
        />
      </div>
    );
  }

  return (
    <Card className="p-8 max-w-xl text-center">
      <p className="text-navy-700 font-semibold text-lg">Set up this counsellor's profile</p>
      <p className="text-sm text-navy-400 mt-1 mb-5">
        Introduce them, share their achievements — their assigned students will see this on their My CC tab.
      </p>
      <Button onClick={() => setEditing(true)}>Get started</Button>
    </Card>
  );
}
