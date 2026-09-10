import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { useAuth } from "../../context/AuthContext";
import { useStudents } from "../../hooks/useStudents";
import { useTeachers } from "../../hooks/useTeachers";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useEnrollmentRequests, type NewPackageInput } from "../../hooks/useEnrollmentRequests";
import { ParentPicker } from "../../components/students/ParentPicker";
import { useStudentPackages, PRESET_HOURS } from "../../hooks/useStudentPackages";
import { useBundlePoolSettings, type BundlePoolDef } from "../../hooks/useBundlePoolSettings";
import { buildEnrollmentInvoicePdf } from "../../utils/buildInvoicePdf";
import type { EnrollmentType, Student, StudentPackage, CourseType } from "../../types/database";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(v: string) {
  return EMAIL_RE.test(v.trim());
}

// One row of the repeatable Package section — an admin can add several of
// these to sell/renew more than one package for a student in a single
// invoice/email/payment-link (added 2026-07-25).
type PackageDraft = {
  key: string;
  courseTypeId: number | "";
  selectedPreset: number | null;
  customHours: string;
  selectedBundlePoolIndex: number | null;
};

function emptyPackageDraft(): PackageDraft {
  return {
    key: crypto.randomUUID(),
    courseTypeId: "",
    selectedPreset: PRESET_HOURS[0],
    customHours: "",
    selectedBundlePoolIndex: null,
  };
}

type PackageInfo = {
  selectedCourseType: CourseType | null;
  bundleDefs: BundlePoolDef[] | undefined;
  isBundle: boolean;
  bundleTotalHours: number;
  bundleAlreadyOwned: boolean;
  selectedBundlePool: BundlePoolDef | null;
  hours: number;
  packageSizeLabel: string;
};

function isPackageValid(draft: PackageDraft, info: PackageInfo) {
  return draft.courseTypeId !== "" && !!info.hours && info.hours > 0 &&
    (!info.isBundle || !info.bundleAlreadyOwned || draft.selectedBundlePoolIndex !== null);
}

export default function AdminEnrollStudentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const { students } = useStudents();
  const { teachers } = useTeachers();
  const { courseTypes } = useCourseTypes();
  const { getPcForStudent } = usePcAssignments();
  const { createEnrollmentRequest, sendInvoiceEmail } = useEnrollmentRequests();
  const { fetchPackagesForStudent } = useStudentPackages();
  const { poolDefsByBundle } = useBundlePoolSettings();

  const coaches = teachers.filter((t) => t.is_performance_coach && t.is_active);
  // Every active course type is offered — the same list the rest of the app
  // sees (course_types is the single source of truth). Foundation Program /
  // All-In-One are "bundle" types that fan out into several package pools;
  // the confirm step (review-enrollment-payment) recreates those pools from
  // the course type's name, so no per-pool data has to be captured here.
  const activeCourseTypes = courseTypes.filter((ct) => ct.is_active);
  const teacherName = (id: string | null) => {
    const t = teachers.find((t) => t.id === id);
    return t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : "Unassigned";
  };

  const [kind, setKind] = useState<EnrollmentType>("new_student");

  // Existing-student picker (renewal) — a renewal only ever finds the
  // student and fills in package details; their personal/contact info is
  // shown nowhere on this form and is never edited here (see the student's
  // own detail page for that). Everything the enrollment request needs is
  // read straight off the already-on-file `selectedStudent` row at submit
  // time, no separate renewal-* form state required.
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // New-student invoice fields — only what's actually required (first name,
  // student email, Performance Coach) plus package details. Everything else
  // (last name, curriculum, phone, school details, parent/guardian info,
  // address/country, report card) is intentionally not collected here — the
  // student fills all of that in themselves on first login via the
  // mandatory "complete your profile" gate (see StudentCompleteProfileGate).
  const [firstName, setFirstName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [pcTeacherId, setPcTeacherId] = useState("");
  // The household this student joins, if the family has a parent account.
  // Optional — a student with no parent account is a normal, complete record;
  // this only decides whether the child also shows up on a parent dashboard.
  const [parentId, setParentId] = useState<string | null>(null);

  // Package fields (both flows) — a repeatable list so one invoice/email/
  // payment link can cover several packages at once instead of forcing a
  // separate request per package.
  const [packages, setPackages] = useState<PackageDraft[]>([emptyPackageDraft()]);
  const [note, setNote] = useState("");

  // The selected (renewal) student's current packages — fetched only to
  // decide whether a bundle course type has already been bought for them
  // (see bundleAlreadyOwned below). A brand-new student can never already
  // own a bundle, so this stays empty for the "New Student" flow.
  const [existingPackages, setExistingPackages] = useState<StudentPackage[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ email: string; paymentUrl?: string } | null>(null);

  // Set when /admin/parents/new sent the admin back here after creating a
  // family mid-enrollment — it reports the account and where its credentials
  // went, which nothing on this page would otherwise say.
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;

  // Deep-link from a student's "Learner's actual hours" tab
  // (…/enroll?student=S2): jump straight to the renewal flow with that
  // student preselected, so adding hours always goes through this invoice
  // path instead of being entered directly on the packages view.
  const preselectStudentId = searchParams.get("student");
  useEffect(() => {
    if (!preselectStudentId) return;
    const match = students.find((s) => s.id === preselectStudentId);
    if (match) {
      setKind("renewal");
      setSelectedStudent(match);
    }
  }, [preselectStudentId, students]);

  // Returning from "+ New parent" (/admin/parents/new?returnTo=…) — that route
  // sends the admin back here with ?parent=<id> so the family they just added
  // is already selected and the enrollment carries on where it left off.
  const preselectParentId = searchParams.get("parent");
  useEffect(() => {
    if (preselectParentId) setParentId(preselectParentId);
  }, [preselectParentId]);

  useEffect(() => {
    if (kind !== "renewal" || !selectedStudent) { setExistingPackages([]); return; }
    let cancelled = false;
    fetchPackagesForStudent(selectedStudent.id).then((pkgs) => { if (!cancelled) setExistingPackages(pkgs); });
    return () => { cancelled = true; };
  }, [kind, selectedStudent, fetchPackagesForStudent]);

  // Switching which student is selected always invalidates whatever
  // specific bundle pool was previously chosen on every row (a course-type
  // change invalidates it per-row instead, via updatePackageRow below).
  useEffect(() => {
    setPackages((prev) => prev.map((p) => ({ ...p, selectedBundlePoolIndex: null })));
  }, [selectedStudent]);

  const matches = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.first_name.toLowerCase().includes(q) ||
          s.last_name.toLowerCase().includes(q) ||
          (s.email ?? "").toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [students, studentSearch]);

  function derivePackageInfo(draft: PackageDraft): PackageInfo {
    const selectedCourseType = draft.courseTypeId === "" ? null : activeCourseTypes.find((ct) => ct.id === draft.courseTypeId) ?? null;
    const bundleDefs = selectedCourseType ? poolDefsByBundle[selectedCourseType.name] : undefined;
    const isBundle = !!bundleDefs;
    const bundleTotalHours = bundleDefs ? bundleDefs.reduce((sum, d) => sum + d.hours, 0) : 0;

    // Whether this bundle has already been bought for the selected (renewal)
    // student — i.e. at least one unlocked pool exists under it. First-time
    // purchase (false) creates the bundle's whole fixed set of pools; already
    // owning it (true) means a specific pool must be picked to top up, not
    // every pool re-filled with its default hours again.
    const bundleAlreadyOwned =
      isBundle && existingPackages.some((p) => !p.is_locked && p.package_type_id === selectedCourseType!.id);
    const selectedBundlePool =
      isBundle && bundleAlreadyOwned && draft.selectedBundlePoolIndex !== null ? bundleDefs![draft.selectedBundlePoolIndex] : null;

    const hoursLabel = draft.selectedPreset !== null ? `${draft.selectedPreset} hours` : `${draft.customHours || "?"} hours (Custom)`;
    const pickedHours = draft.selectedPreset !== null ? draft.selectedPreset : parseFloat(draft.customHours);

    // For a first-time bundle purchase the per-pool hours are fixed by the
    // bundle definition — the request records the bundle total and its name,
    // and the confirm step builds every pool. Once the bundle is already
    // owned, hours/label come from the same manual picker as a standalone
    // package, applied to just the one chosen pool.
    const hours = isBundle ? (bundleAlreadyOwned ? pickedHours : bundleTotalHours) : pickedHours;
    // Kept distinct from the course type name shown alongside it everywhere
    // this gets displayed (Enrollments queue, invoice email/PDF) — repeating
    // "Foundation Program" in both the course type and the label read as a
    // confusing duplicate ("Foundation Program — Foundation Program bundle").
    const packageSizeLabel = isBundle
      ? (bundleAlreadyOwned
          ? (selectedBundlePool ? `${hoursLabel} — ${selectedBundlePool.label ?? selectedBundlePool.courseTypeName}` : hoursLabel)
          : "Full bundle (all pools)")
      : hoursLabel;

    return { selectedCourseType, bundleDefs, isBundle, bundleTotalHours, bundleAlreadyOwned, selectedBundlePool, hours, packageSizeLabel };
  }

  const packagesInfo = useMemo(
    () => packages.map(derivePackageInfo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [packages, existingPackages, activeCourseTypes, poolDefsByBundle]
  );

  function addPackageRow() {
    setPackages((prev) => [...prev, emptyPackageDraft()]);
  }
  function removePackageRow(key: string) {
    setPackages((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.key !== key)));
  }
  function updatePackageRow(key: string, patch: Partial<PackageDraft>) {
    setPackages((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  const canSubmit =
    !!profile &&
    packages.every((draft, i) => isPackageValid(draft, packagesInfo[i])) &&
    (kind === "renewal"
      ? !!selectedStudent
      : Boolean(firstName.trim()) && isValidEmail(studentEmail) && !!pcTeacherId);

  function resetForNewSubmission() {
    setSelectedStudent(null);
    setStudentSearch("");
    setFirstName(""); setStudentEmail(""); setPcTeacherId(""); setParentId(null);
    setPackages([emptyPackageDraft()]);
    setNote("");
    setExistingPackages([]);
  }

  async function handleSubmit() {
    if (!profile || !canSubmit) return;
    setSaving(true);
    setError(null);

    const packageInputs: NewPackageInput[] = packages.map((draft, i) => {
      const info = packagesInfo[i];
      return {
        course_type_id: draft.courseTypeId as number,
        hours: info.hours,
        package_size_label: info.packageSizeLabel,
        is_bundle_pool_selection: info.isBundle && info.bundleAlreadyOwned,
        bundle_pool_label: info.selectedBundlePool ? info.selectedBundlePool.label : null,
      };
    });

    const base = {
      enrollment_type: kind,
      note: note.trim() || null,
      created_by_user_id: profile.id,
    };

    const input =
      kind === "renewal" && selectedStudent
        ? {
            ...base,
            student_id: selectedStudent.id,
            first_name: selectedStudent.first_name,
            last_name: selectedStudent.last_name,
            parent_full_name: selectedStudent.parent_full_name,
            // Read off the student, not the form: a renewal never re-picks a
            // household, and confirm only ever copies this onto a *new*
            // student anyway.
            parent_id: selectedStudent.parent_id ?? null,
            // The invoice/payment-link goes to the "send updates to" email
            // already on file, else the student's own login email as a
            // last resort — nothing here is editable, all read straight
            // off the existing student row.
            email: selectedStudent.notification_email || selectedStudent.email || "",
            student_email: selectedStudent.email ?? null,
            notification_email: selectedStudent.notification_email ?? null,
            curriculum: selectedStudent.curriculum ?? null,
            report_card_url: selectedStudent.report_card_url ?? null,
            phone_number: selectedStudent.parent_phone_number ?? null,
            student_phone_number: selectedStudent.phone_number ?? null,
            address: selectedStudent.address ?? null,
            country: selectedStudent.country ?? null,
            packages: packageInputs,
          }
        : {
            ...base,
            first_name: firstName.trim(),
            // Not collected here — the student fills in everything else
            // (last name, curriculum, phone, school details, guardian info,
            // address/country, report card) on first login instead.
            last_name: "",
            parent_full_name: null,
            parent_id: parentId,
            email: studentEmail.trim(),
            student_email: studentEmail.trim(),
            notification_email: null,
            curriculum: null,
            report_card_url: null,
            phone_number: null,
            student_phone_number: null,
            address: null,
            country: null,
            graduation_year: null,
            birthday: null,
            school: null,
            pc_teacher_id: pcTeacherId ? pcTeacherId : null,
            packages: packageInputs,
          };

    if (!input.email) {
      setSaving(false);
      setError(
        kind === "renewal"
          ? "This student has no email on file — add one from their Student Details page first, since the invoice and payment link are sent by email."
          : "This student has no email on file — add a student email, since the invoice and payment link are sent by email."
      );
      return;
    }

    const { data, error: createError } = await createEnrollmentRequest(input);
    if (createError || !data) {
      setSaving(false);
      setError(createError);
      return;
    }

    const coordinatorName =
      kind === "renewal" && selectedStudent
        ? teacherName(getPcForStudent(selectedStudent.id))
        : teacherName(pcTeacherId ? pcTeacherId : null);

    const pdfDoc = buildEnrollmentInvoicePdf({
      kindLabel: kind === "new_student" ? "New Enrollment" : "Package Renewal",
      parentFullName: input.parent_full_name ?? null,
      phoneNumber: input.phone_number ?? null,
      email: input.email,
      learnerName: `${input.first_name} ${input.last_name}`,
      address: input.address ?? null,
      country: input.country ?? null,
      packages: packages.map((draft, i) => ({
        courseTypeName: activeCourseTypes.find((ct) => ct.id === draft.courseTypeId)?.name ?? "Package",
        packageSizeLabel: packagesInfo[i].packageSizeLabel,
        hours: packagesInfo[i].hours,
      })),
      coordinatorName,
      note: note.trim() || null,
    });
    const invoicePdfBase64 = pdfDoc.output("datauristring").split(",")[1];

    const { error: emailError } = await sendInvoiceEmail({ enrollmentRequestId: data.id, coordinatorName, invoicePdfBase64 });
    setSaving(false);
    if (emailError) {
      setError(`Request saved, but the invoice email failed to send: ${emailError}. You can resend it from the Enrollments queue.`);
      return;
    }

    const recipients = Array.from(new Set([data.email, data.student_email].filter((e): e is string => !!e)));
    setSuccessInfo({ email: recipients.join(" and ") });
    resetForNewSubmission();
  }

  return (
    <AdminLayout>
      <PageHeader
        title="Add / Renew Student"
        action={
          <Button variant="ghost" onClick={() => navigate("/admin/enrollments")}>
            View Enrollments Queue
          </Button>
        }
      />

      {notice && (
        <p className="text-sm text-lime-700 bg-lime-50 border border-lime-100 rounded-lg px-3 py-2 mb-4">
          {notice}
        </p>
      )}

      {successInfo && (
        <Card className="p-4 mb-6 border border-lime-200 bg-lime-50">
          <p className="text-sm font-semibold text-lime-700">Invoice sent to {successInfo.email}.</p>
          <p className="text-xs text-lime-600 mt-1">They'll receive the payment link by email. Once they upload proof of payment, review it from the Enrollments queue.</p>
        </Card>
      )}

      <Card className="p-5 max-w-2xl">
        <div className="flex gap-2 mb-5">
          <button
            type="button"
            onClick={() => { setKind("new_student"); setError(null); }}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
              kind === "new_student" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-navy-100 text-navy-400 hover:border-sky-200"
            }`}
          >
            New Student
          </button>
          <button
            type="button"
            onClick={() => { setKind("renewal"); setError(null); }}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
              kind === "renewal" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-navy-100 text-navy-400 hover:border-sky-200"
            }`}
          >
            Renew Existing Student
          </button>
        </div>

        {kind === "renewal" ? (
          <div className="mb-5">
            <label className="block text-xs font-medium text-navy-500 mb-1.5">Find student</label>
            {selectedStudent ? (
              <div className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-navy-700">
                    {selectedStudent.first_name} {selectedStudent.last_name}{" "}
                    <span className="font-mono text-xs text-sky-500">{selectedStudent.id}</span>
                  </p>
                  <p className="text-xs text-navy-400 truncate">{selectedStudent.email ?? "No email on file"}</p>
                </div>
                <button type="button" onClick={() => setSelectedStudent(null)} className="text-xs text-navy-400 hover:text-red-500 shrink-0 ml-3">
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  autoFocus
                  placeholder="Search by student ID, name, or email…"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  className="w-full rounded-xl border border-navy-100 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                {matches.length > 0 && (
                  <div className="mt-2 border border-navy-50 rounded-xl max-h-64 overflow-y-auto">
                    {matches.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setSelectedStudent(s); setStudentSearch(""); }}
                        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-sky-50 transition-colors border-b border-navy-50 last:border-b-0"
                      >
                        <span className="text-sm text-navy-700">{s.first_name} {s.last_name} <span className="font-mono text-xs text-sky-500">{s.id}</span></span>
                        <span className="text-xs text-navy-300 truncate ml-2">{s.email ?? "No email"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {kind === "new_student" ? (
          <div className="flex flex-col gap-3 mb-5">
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">
              Student information
            </p>
            <TextInput label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            <div>
              <TextInput label="Student email (used to create the login)" type="email" value={studentEmail} onChange={(e) => setStudentEmail(e.target.value)} placeholder="student@example.com" required />
              {studentEmail.trim().length > 0 && !isValidEmail(studentEmail) && <p className="text-xs text-red-500 mt-1">Enter a valid email address.</p>}
            </div>
            <SelectInput
              label="Performance Coach"
              placeholder="Select the coach…"
              value={pcTeacherId}
              onChange={(e) => setPcTeacherId(e.target.value)}
              options={coaches.map((c) => ({ value: String(c.id), label: `${c.first_name} ${c.last_name ?? ""}`.trim() }))}
              required
            />
            {coaches.length === 0 && <p className="text-xs text-amber-600">No active Performance Coaches found — mark a teacher as a coach first.</p>}
            <ParentPicker
              label="Parent"
              value={parentId}
              onChange={setParentId}
              returnTo="/admin/students/enroll"
            />
          </div>
        ) : null}

        <div className="border-t border-navy-50 pt-4 flex flex-col gap-4">
          <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">
            {packages.length > 1 ? "Packages" : "Package"}
          </p>

          {packages.map((draft, i) => {
            const info = packagesInfo[i];
            return (
              <div key={draft.key} className="rounded-xl border border-navy-100 p-3.5 flex flex-col gap-3">
                {packages.length > 1 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-navy-400">Package {i + 1}</span>
                    <button type="button" onClick={() => removePackageRow(draft.key)} className="text-xs text-navy-400 hover:text-red-500">
                      Remove
                    </button>
                  </div>
                )}

                <SelectInput
                  label="Course type"
                  placeholder="Select a package type…"
                  value={draft.courseTypeId === "" ? "" : String(draft.courseTypeId)}
                  onChange={(e) => updatePackageRow(draft.key, { courseTypeId: e.target.value ? Number(e.target.value) : "", selectedBundlePoolIndex: null })}
                  options={activeCourseTypes.map((ct) => ({ value: String(ct.id), label: ct.name }))}
                  required
                />

                {info.isBundle && info.bundleDefs && !info.bundleAlreadyOwned && (
                  <div>
                    <label className="block text-xs font-medium text-navy-500 mb-1.5">
                      Bundle pools <span className="font-normal text-navy-400">— created automatically once payment is confirmed</span>
                    </label>
                    <div className="rounded-xl border border-navy-100 divide-y divide-navy-50">
                      {info.bundleDefs.map((pool, pi) => (
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
                        <span className="text-navy-700 tabular-nums">{info.bundleTotalHours}h</span>
                      </div>
                    </div>
                  </div>
                )}

                {info.isBundle && info.bundleDefs && info.bundleAlreadyOwned && (
                  <div>
                    <label className="block text-xs font-medium text-navy-500 mb-1.5">
                      Pool to add hours to <span className="font-normal text-navy-400">— {info.selectedCourseType!.name} was already bought for this student; pick exactly one pool to top up</span>
                    </label>
                    <select
                      value={draft.selectedBundlePoolIndex ?? ""}
                      onChange={(e) => updatePackageRow(draft.key, { selectedBundlePoolIndex: e.target.value === "" ? null : Number(e.target.value) })}
                      className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                    >
                      <option value="" disabled>Select a pool…</option>
                      {info.bundleDefs.map((pool, pi) => (
                        <option key={pi} value={pi}>
                          {pool.label ?? pool.courseTypeName}{pool.label ? ` (${pool.courseTypeName})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(!info.isBundle || info.bundleAlreadyOwned) && (
                  <div>
                    <label className="block text-xs font-medium text-navy-500 mb-1.5">Hours</label>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_HOURS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => updatePackageRow(draft.key, { selectedPreset: h, customHours: "" })}
                          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                            draft.selectedPreset === h ? "border-sky-300 bg-sky-50 text-sky-700" : "border-navy-100 text-navy-500 hover:border-sky-200"
                          }`}
                        >
                          {h}h
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => updatePackageRow(draft.key, { selectedPreset: null })}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                          draft.selectedPreset === null ? "border-sky-300 bg-sky-50 text-sky-700" : "border-navy-100 text-navy-500 hover:border-sky-200"
                        }`}
                      >
                        Custom
                      </button>
                    </div>
                    {draft.selectedPreset === null && (
                      <input
                        type="number" min="0.25" step="0.25" placeholder="e.g. 4" value={draft.customHours}
                        onChange={(e) => updatePackageRow(draft.key, { customHours: e.target.value })}
                        className="mt-2 rounded-lg border border-navy-100 px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-sky-300"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addPackageRow}
            className="self-start text-xs font-semibold text-sky-600 hover:text-sky-700"
          >
            + Add another package
          </button>

          <TextInput label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the admin reviewing payment should know" />

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

          <Button onClick={handleSubmit} disabled={!canSubmit || saving} className="self-start">
            {saving ? "Sending…" : "Send Invoice & Payment Link"}
          </Button>
        </div>
      </Card>
    </AdminLayout>
  );
}
