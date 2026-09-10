import { useEffect, useState } from "react";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { SelectInput, TextInput } from "../../components/ui/Input";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { Toast } from "../../components/ui/Toast";
import { StudentSearch } from "../../components/ui/StudentSearch";
import { useRenewalRequests, type PackageRenewalRequestWithCourseType } from "../../hooks/useRenewalRequests";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useStudentPackages, PRESET_HOURS } from "../../hooks/useStudentPackages";
import { useBundlePoolSettings } from "../../hooks/useBundlePoolSettings";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useCcAssignments } from "../../hooks/useCcAssignments";
import { useStudents } from "../../hooks/useStudents";
import { useAuth } from "../../context/AuthContext";
import { loggableStudentIds } from "../../utils/ccAssignment";
import { staffRoleFlags } from "../../utils/staffRole";
import type { PackageRenewalStatus, Student, StudentPackage } from "../../types/database";

// "unspecified" — the PC just wants to flag a renewal is needed, without
// guessing at hours; "custom" — a manual amount via customHours; otherwise
// one of PRESET_HOURS, same preset set used on the admin enroll form so a
// PC's suggestion lines up with what the admin will actually pick from.
type HoursChoice = "unspecified" | "custom" | number;

const STATUS_LABEL: Record<PackageRenewalStatus, string> = {
  pending: "Awaiting Acknowledgement",
  acknowledged: "Acknowledged",
  renewed: "Renewed",
};

const STATUS_BADGE: Record<PackageRenewalStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  acknowledged: "bg-sky-100 text-sky-700",
  renewed: "bg-lime-100 text-lime-700",
};

const emptyForm = {
  studentId: null as string | null,
  courseTypeId: "",
  hoursChoice: "unspecified" as HoursChoice,
  customHours: "",
  selectedBundlePoolIndex: null as number | null,
  note: "",
};

export default function TeacherRenewalRequestsPage() {
  const { fetchMine, createRenewalRequest } = useRenewalRequests();
  const { courseTypes } = useCourseTypes();
  const { fetchPackagesForStudent } = useStudentPackages();
  const { poolDefsByBundle } = useBundlePoolSettings();
  const { teacher } = useMyTeacherProfile();
  const { profile } = useAuth();
  const { activeAssignments } = usePcAssignments();
  const { activeAssignments: activeCcAssignmentRows } = useCcAssignments();
  const { students } = useStudents();

  const [rows, setRows] = useState<PackageRenewalRequestWithCourseType[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [existingPackages, setExistingPackages] = useState<StudentPackage[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" } | null>(null);

  // Whether the selected package type is a bundle (Foundation Program /
  // All-In-One), and whether the selected student already owns it — mirrors
  // AdminEnrollStudentPage's derivePackageInfo, since a renewal request must
  // offer the same choice the admin's actual renewal form does: pick which
  // pool to top up if the bundle is already theirs, or nothing extra (no
  // hours to guess at) if this would be their first purchase of it.
  const selectedCourseType = form.courseTypeId ? courseTypes.find((c) => c.id === Number(form.courseTypeId)) ?? null : null;
  const bundleDefs = selectedCourseType ? poolDefsByBundle[selectedCourseType.name] : undefined;
  const isBundle = !!bundleDefs;
  const bundleAlreadyOwned = isBundle && existingPackages.some((p) => !p.is_locked && p.package_type_id === selectedCourseType!.id);

  useEffect(() => {
    if (!adding || !form.studentId) { setExistingPackages([]); return; }
    let cancelled = false;
    // Include the student's FAMILY pools (2026-09-11): a bundle the family
    // already owns counts as owned for this student too, so the form offers
    // "top up a pool" rather than "buy the bundle again".
    const parentId = students.find((s) => s.id === form.studentId)?.parent_id ?? null;
    fetchPackagesForStudent(form.studentId, parentId).then((pkgs) => { if (!cancelled) setExistingPackages(pkgs); });
    return () => { cancelled = true; };
  }, [adding, form.studentId, fetchPackagesForStudent, students]);

  // Coaches and counsellors both file renewals now, so the picker is the union
  // of whichever rosters this person actually has — the same rule that decides
  // who they may log a session against, and the same one the INSERT policy
  // enforces via `is_my_assigned_student()`.
  const { isCoach, isCounsellor } = staffRoleFlags(profile?.role, teacher);
  const myAssignedIds =
    loggableStudentIds({
      isAdmin: false,
      teacherId: teacher?.id ?? null,
      isCoach,
      isCounsellor,
      activePcAssignments: activeAssignments,
      activeCcAssignments: activeCcAssignmentRows,
    }) ?? new Set<string>();

  async function load() {
    setLoading(true);
    const data = await fetchMine();
    setRows(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openAdd() {
    setForm(emptyForm);
    setFormError(null);
    setAdding(true);
  }

  function cancelAdd() {
    setAdding(false);
    setFormError(null);
  }

  async function handleSubmit() {
    if (!teacher) return;
    if (!form.studentId) { setFormError("Pick a student."); return; }
    const courseTypeId = parseInt(form.courseTypeId, 10);
    if (!courseTypeId) { setFormError("Pick a package type."); return; }
    if (isBundle && bundleAlreadyOwned && form.selectedBundlePoolIndex === null) {
      setFormError("Pick which pool needs renewing.");
      return;
    }

    let hours: number | null = null;
    let packageSizeLabel: string | null = null;
    // A first-time bundle purchase has no pools yet to renew and no hours to
    // guess at (the admin form creates the whole fixed bundle at once) — so
    // this is submitted with no hours/label at all, just the package type.
    if (!(isBundle && !bundleAlreadyOwned)) {
      if (form.hoursChoice === "custom") {
        const parsed = form.customHours.trim() ? parseFloat(form.customHours) : NaN;
        if (!parsed || parsed <= 0) { setFormError("Enter a positive custom hours amount, or pick a package instead."); return; }
        hours = parsed;
        packageSizeLabel = `${parsed} hours (Custom)`;
      } else if (form.hoursChoice !== "unspecified") {
        hours = form.hoursChoice;
        packageSizeLabel = `${form.hoursChoice} hours`;
      }
      if (isBundle && bundleAlreadyOwned && bundleDefs && form.selectedBundlePoolIndex !== null) {
        const poolName = bundleDefs[form.selectedBundlePoolIndex].label ?? bundleDefs[form.selectedBundlePoolIndex].courseTypeName;
        packageSizeLabel = packageSizeLabel ? `${packageSizeLabel} — ${poolName}` : poolName;
      }
    }

    setSaving(true);
    setFormError(null);
    const { error } = await createRenewalRequest({
      student_id: form.studentId,
      course_type_id: courseTypeId,
      requested_hours: hours,
      package_size_label: packageSizeLabel,
      note: form.note.trim() || null,
      requested_by_teacher_id: teacher.id,
    });
    setSaving(false);
    if (error) { setFormError(error); return; }
    setAdding(false);
    setToast({ message: "Renewal request sent — the admin has been emailed.", variant: "success" });
    load();
  }

  const columns: ColumnDef<PackageRenewalRequestWithCourseType>[] = [
    {
      header: "Student",
      accessor: (r) => {
        const s = students.find((s: Student) => s.id === r.student_id);
        return s ? `${s.id} — ${s.first_name} ${s.last_name}` : r.student_id;
      },
    },
    {
      header: "Package",
      accessor: (r) => (
        <div className="min-w-0">
          <p className="text-navy-700 font-medium">{r.course_types?.name ?? `Type ${r.course_type_id}`}</p>
          {(r.requested_hours != null || r.package_size_label) && (
            <p className="text-xs text-navy-300">{r.requested_hours != null ? `${r.requested_hours} hrs` : ""}{r.package_size_label ? `${r.requested_hours != null ? " — " : ""}${r.package_size_label}` : ""}</p>
          )}
        </div>
      ),
    },
    { header: "Note", accessor: (r) => r.note || <span className="text-navy-200 italic">—</span> },
    {
      header: "Status",
      accessor: (r) => <span className={`inline-block rounded-pill px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>,
    },
    { header: "Requested", accessor: (r) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <TeacherLayout>
      <PageHeader
        title="Renewal Requests"
        description="Tell the admin when one of your students needs their package renewed."
        action={!adding ? <Button onClick={openAdd}>+ Request Renewal</Button> : undefined}
      />

      {adding && (
        <Card className="p-4 mb-5 max-w-lg">
          <h2 className="text-sm font-semibold text-navy-700 mb-3">New Renewal Request</h2>
          <div className="flex flex-col gap-3">
            <StudentSearch
              label="Student"
              value={form.studentId}
              onChange={(s) => setForm((f) => ({ ...f, studentId: s?.id ?? null, selectedBundlePoolIndex: null }))}
              allowedIds={myAssignedIds}
              emptyAllowedMessage="You have no assigned students yet."
              required
            />
            <SelectInput
              label="Package type"
              value={form.courseTypeId}
              onChange={(e) => setForm((f) => ({ ...f, courseTypeId: e.target.value, selectedBundlePoolIndex: null }))}
              placeholder="Select a package type…"
              options={courseTypes.filter((c) => c.is_active).map((c) => ({ value: String(c.id), label: c.name }))}
              required
            />

            {isBundle && bundleDefs && bundleAlreadyOwned && (
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1.5">
                  Pool to renew <span className="text-red-500 ml-0.5">*</span>
                  <span className="font-normal normal-case text-navy-400"> — {selectedCourseType!.name} is already active for this student; pick which pool needs renewing</span>
                </label>
                <select
                  value={form.selectedBundlePoolIndex ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, selectedBundlePoolIndex: e.target.value === "" ? null : Number(e.target.value) }))}
                  className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  <option value="" disabled>Select a pool…</option>
                  {bundleDefs.map((pool, pi) => (
                    <option key={pi} value={pi}>
                      {pool.label ?? pool.courseTypeName}{pool.label ? ` (${pool.courseTypeName})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isBundle && bundleDefs && !bundleAlreadyOwned && (
              <div className="rounded-xl border border-navy-100 p-3">
                <p className="text-xs text-navy-500 mb-2">
                  {selectedCourseType!.name} isn't purchased for this student yet — this is a request for the full bundle below, so there's no hours to pick.
                </p>
                <div className="rounded-lg border border-navy-100 divide-y divide-navy-50">
                  {bundleDefs.map((pool, pi) => (
                    <div key={pi} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-navy-600">
                        {pool.label ?? pool.courseTypeName}
                        {pool.label && <span className="text-navy-400"> · {pool.courseTypeName}</span>}
                      </span>
                      <span className="text-navy-500 tabular-nums">{pool.hours}h</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold bg-navy-50/50">
                    <span className="text-navy-600">Total</span>
                    <span className="text-navy-700 tabular-nums">{bundleDefs.reduce((sum, d) => sum + d.hours, 0)}h</span>
                  </div>
                </div>
              </div>
            )}

            {!(isBundle && !bundleAlreadyOwned) && (
            <div>
              <label className="block text-xs font-medium text-navy-500 mb-1.5">Suggested package (optional)</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, hoursChoice: "unspecified" }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    form.hoursChoice === "unspecified" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-navy-100 text-navy-500 hover:border-sky-200"
                  }`}
                >
                  Not sure
                </button>
                {PRESET_HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, hoursChoice: h }))}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      form.hoursChoice === h ? "border-sky-300 bg-sky-50 text-sky-700" : "border-navy-100 text-navy-500 hover:border-sky-200"
                    }`}
                  >
                    {h}h
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, hoursChoice: "custom" }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    form.hoursChoice === "custom" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-navy-100 text-navy-500 hover:border-sky-200"
                  }`}
                >
                  Custom
                </button>
              </div>
              {form.hoursChoice === "custom" && (
                <input
                  type="number" min="0.25" step="0.25" placeholder="e.g. 20" value={form.customHours}
                  onChange={(e) => setForm((f) => ({ ...f, customHours: e.target.value }))}
                  className="mt-2 rounded-lg border border-navy-100 px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              )}
            </div>
            )}
            <TextInput
              label="Note for admin (optional)"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
            {formError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={cancelAdd}>Cancel</Button>
              <Button size="sm" onClick={handleSubmit} disabled={saving}>{saving ? "Sending…" : "Send Request"}</Button>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm py-8"><Spinner /> Loading…</div>
      ) : (
        <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} emptyMessage="You haven't requested any renewals yet." />
      )}

      {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </TeacherLayout>
  );
}
