import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { useAuth } from "../../context/AuthContext";
import { useStudents } from "../../hooks/useStudents";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useStudentPackages, PRESET_HOURS } from "../../hooks/useStudentPackages";
import { useBundlePoolSettings } from "../../hooks/useBundlePoolSettings";
import { childrenOf } from "../../utils/parentDirectory";
import {
  shareableCourseTypes,
  coSharerCandidates,
  canSellShared,
  sharedLineIssue,
  pickCoSharer,
  packageCreatedNotice,
  packageCreateErrorMessage,
  type PackageOwnership,
} from "../../utils/sharedPackages";
import { formatHours } from "../../utils/formatHours";
import type { Student } from "../../types/database";

/**
 * Add a package (/admin/packages/new).
 *
 * Ownership is the first question, and the student is the second either way:
 *
 *   * INDIVIDUAL — find the student, pick any course type, pick the hours.
 *     Bundles (Foundation Program / All-In-One) fan out into their fixed set of
 *     pools here, each at the hours `bundle_pool_settings` defines.
 *   * SHARED — find the student, and their siblings appear to pick from. The
 *     pool is owned by the household and drawn on by that student plus the
 *     sibling chosen here; only the shareable course types (Academic / Beyond
 *     Academic) can be bought this way. The parent is never asked to choose —
 *     an admin assigns the pair.
 *
 * Starting from the student rather than the household is what makes the two
 * branches one form: every package belongs to a student one way or another, and
 * the household is read off the student rather than searched for separately.
 *
 * No money anywhere on this form: no invoice, no payment link, no proof to
 * review. The hours land immediately. `?parent=<id>` starts it on the shared
 * branch — how a family's own hours page links here.
 */
export default function AdminPackageFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();

  const { students } = useStudents();
  const { courseTypes } = useCourseTypes();
  const { createSharedPackage, createIndividualPackage } = useStudentPackages();
  const { poolDefsByBundle } = useBundlePoolSettings();

  const [ownership, setOwnership] = useState<PackageOwnership>(
    searchParams.get("parent") ? "shared" : "individual",
  );
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [coSharerIds, setCoSharerIds] = useState<string[]>([]);
  const [courseTypeId, setCourseTypeId] = useState<number | "">("");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(PRESET_HOURS[0]);
  const [customHours, setCustomHours] = useState("");
  const [note, setNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The household is the student's, never picked separately — which is what
  // lets "who else could this be shared with" be a list of their siblings.
  const householdParentId = selectedStudent?.parent_id ?? null;
  const householdChildren = useMemo(
    () => childrenOf(students, householdParentId),
    [students, householdParentId],
  );
  const coSharerOptions = coSharerCandidates(householdChildren, selectedStudent?.id ?? null);
  const sharingAvailable = canSellShared(
    householdParentId,
    householdChildren,
    selectedStudent?.id ?? null,
  );

  // Shared survives only while the picked student still has a sibling to share
  // with. Derived rather than written back to state, so changing student can't
  // leave a package the database would refuse.
  const isShared = ownership === "shared" && sharingAvailable;
  const pickedCoSharerIds = isShared
    ? coSharerIds.filter((id) => coSharerOptions.some((c) => c.id === id))
    : [];
  const sharedIssue = ownership === "shared" && selectedStudent
    ? sharedLineIssue(householdParentId, householdChildren, selectedStudent.id, pickedCoSharerIds)
    : null;

  // Shared hours only exist for the course types sold that way; individual
  // hours can be any active one, bundles included.
  const offeredCourseTypes = useMemo(
    () => (ownership === "shared"
      ? shareableCourseTypes(courseTypes)
      : courseTypes.filter((ct) => ct.is_active)),
    [ownership, courseTypes],
  );
  const selectedCourseType = courseTypeId === ""
    ? null
    : offeredCourseTypes.find((c) => c.id === courseTypeId) ?? null;

  // Only an individual package can be a bundle — every bundle contains a
  // College Counselling pool, which is bought per student.
  const bundleDefs = ownership === "individual" && selectedCourseType
    ? poolDefsByBundle[selectedCourseType.name]
    : undefined;
  const isBundle = !!bundleDefs;

  const hours = useMemo(() => {
    if (isBundle) return bundleDefs!.reduce((sum, d) => sum + d.hours, 0);
    return selectedPreset !== null ? selectedPreset : parseFloat(customHours);
  }, [isBundle, bundleDefs, selectedPreset, customHours]);

  const studentMatches = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) =>
        [s.id, s.first_name, s.last_name, `${s.first_name} ${s.last_name}`, s.email ?? ""]
          .some((field) => field.toLowerCase().includes(q)),
      )
      .slice(0, 20);
  }, [students, studentSearch]);

  const canSubmit = Boolean(profile) && !!selectedStudent && sharedIssue === null &&
    courseTypeId !== "" && !!hours && hours > 0 && !saving;

  function selectOwnership(next: PackageOwnership) {
    // The two branches offer different course types — only Academic and Beyond
    // Academic can be shared — so the pick never survives a switch.
    setOwnership(next);
    setCourseTypeId("");
    setSelectedPreset(PRESET_HOURS[0]);
    setCustomHours("");
    setCoSharerIds([]);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !profile || !selectedStudent) return;
    setSaving(true);
    setError(null);

    // A bundle is several pools, each with its own real deducting course type
    // and its own fixed hours, grouped under the bundle via package_type_id —
    // the same shape review-enrollment-payment builds.
    const toCreate = isBundle
      ? bundleDefs!.map((d) => ({
          courseTypeId: courseTypes.find((c) => c.name === d.courseTypeName)?.id,
          poolLabel: d.label,
          packageTypeId: courseTypeId as number,
          hours: d.hours,
          label: d.label ?? d.courseTypeName,
        }))
      : [{
          courseTypeId: courseTypeId as number,
          poolLabel: null,
          packageTypeId: null,
          hours,
          label: selectedCourseType?.name ?? "Package",
        }];

    const missing = toCreate.find((p) => p.courseTypeId == null);
    if (missing) {
      setSaving(false);
      setError(`Bundle pool course type "${missing.label}" isn't in the course types list.`);
      return;
    }

    for (const p of toCreate) {
      const { error: createErr } = isShared
        ? await createSharedPackage({
            parentId: householdParentId as string,
            studentIds: [selectedStudent.id, ...pickedCoSharerIds],
            courseTypeId: p.courseTypeId as number,
            packageTypeId: p.packageTypeId,
            poolLabel: p.poolLabel,
            initialHours: p.hours,
            note: note.trim() || null,
            addedByUserId: profile.id,
          })
        : await createIndividualPackage({
            studentId: selectedStudent.id,
            courseTypeId: p.courseTypeId as number,
            packageTypeId: p.packageTypeId,
            poolLabel: p.poolLabel,
            initialHours: p.hours,
            note: note.trim() || null,
            addedByUserId: profile.id,
          });
      if (createErr) {
        setSaving(false);
        setError(`"${p.label}" failed: ${packageCreateErrorMessage(createErr)}`);
        return;
      }
    }

    setSaving(false);
    const nameOf = (id: string) =>
      householdChildren.find((c) => c.id === id)?.first_name ?? id;
    const notice = packageCreatedNotice({
      hours,
      ownership: isShared ? "shared" : "individual",
      studentNames: isShared
        ? [selectedStudent.first_name, ...pickedCoSharerIds.map(nameOf)]
        : [selectedStudent.first_name],
    });
    navigate(
      isShared ? `/admin/parents/${householdParentId}/packages` : "/admin/packages",
      { state: { notice } },
    );
  }

  return (
    <AdminLayout>
      <PageHeader title="Add package" />

      <Card className="p-6 max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1.5">Ownership</label>
            <div className="flex gap-2">
              {(["individual", "shared"] as PackageOwnership[]).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => selectOwnership(o)}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                    ownership === o
                      ? "border-sky-300 bg-sky-50 text-sky-700"
                      : "border-navy-100 text-navy-400 hover:border-sky-200"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1.5">Student</label>
            {selectedStudent ? (
              <div className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5">
                <p className="text-sm font-semibold text-navy-700">
                  {selectedStudent.first_name} {selectedStudent.last_name}{" "}
                  <span className="font-mono text-xs text-sky-500">{selectedStudent.id}</span>
                </p>
                <button
                  type="button"
                  onClick={() => { setSelectedStudent(null); setCoSharerIds([]); }}
                  className="text-xs text-navy-400 hover:text-red-500 shrink-0 ml-3"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Search by name, student ID or email…"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  className="w-full rounded-xl border border-navy-100 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                {studentSearch.trim() && studentMatches.length === 0 && (
                  <p className="text-xs text-navy-300 mt-2">No student matches that.</p>
                )}
                {studentMatches.length > 0 && (
                  <div className="mt-2 border border-navy-50 rounded-xl max-h-64 overflow-y-auto">
                    {studentMatches.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setSelectedStudent(s); setStudentSearch(""); setCoSharerIds([]); }}
                        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-sky-50 transition-colors border-b border-navy-50 last:border-b-0"
                      >
                        <span className="text-sm text-navy-700">
                          {s.first_name} {s.last_name}{" "}
                          <span className="font-mono text-xs text-sky-500">{s.id}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {ownership === "shared" && selectedStudent && (
            <div>
              <label className="block text-xs font-medium text-navy-500 mb-1.5">Shared with</label>
              {coSharerOptions.length === 0 ? (
                <p className="text-sm text-navy-400">{sharedIssue}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {coSharerOptions.map((c) => {
                      const picked = pickedCoSharerIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setCoSharerIds(pickCoSharer(pickedCoSharerIds, c.id))}
                          className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors ${
                            picked
                              ? "border-sky-300 bg-sky-50 text-sky-700"
                              : "border-navy-100 text-navy-500 hover:border-sky-200"
                          }`}
                        >
                          {c.first_name} {c.last_name}
                          <span className="font-mono opacity-70">{c.id}</span>
                        </button>
                      );
                    })}
                  </div>
                  {sharedIssue && <p className="text-xs text-navy-400 mt-2">{sharedIssue}</p>}
                </>
              )}
            </div>
          )}

          <SelectInput
            label="Course type"
            placeholder="Select…"
            value={courseTypeId === "" ? "" : String(courseTypeId)}
            onChange={(e) => {
              setCourseTypeId(e.target.value === "" ? "" : Number(e.target.value));
              setSelectedPreset(PRESET_HOURS[0]);
              setCustomHours("");
            }}
            options={offeredCourseTypes.map((ct) => ({ value: String(ct.id), label: ct.name }))}
            required
          />

          {isBundle ? (
            <div className="rounded-xl border border-navy-100 p-4">
              <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">
                Pools created
              </p>
              <ul className="flex flex-col gap-1 text-sm text-navy-600">
                {bundleDefs!.map((d) => (
                  <li key={`${d.label ?? d.courseTypeName}`} className="flex justify-between">
                    <span>{d.label ?? d.courseTypeName}</span>
                    <span className="font-semibold text-navy-700">{formatHours(d.hours)} hrs</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-navy-500 mb-1.5">Hours</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => { setSelectedPreset(h); setCustomHours(""); }}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                      selectedPreset === h
                        ? "border-sky-300 bg-sky-50 text-sky-700"
                        : "border-navy-100 text-navy-400 hover:border-sky-200"
                    }`}
                  >
                    {h}
                  </button>
                ))}
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  placeholder="Custom"
                  value={customHours}
                  onChange={(e) => { setCustomHours(e.target.value); setSelectedPreset(null); }}
                  className={`w-28 rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                    selectedPreset === null ? "border-sky-300 bg-sky-50" : "border-navy-100"
                  }`}
                />
              </div>
            </div>
          )}

          <TextInput label="Note" value={note} onChange={(e) => setNote(e.target.value)} />

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={!canSubmit}>
              {saving ? "Adding…" : "Add package"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/admin/packages")}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </AdminLayout>
  );
}
