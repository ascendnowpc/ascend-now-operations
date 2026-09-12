import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { ParentPicker } from "../../components/students/ParentPicker";
import { useAuth } from "../../context/AuthContext";
import { useStudents } from "../../hooks/useStudents";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useStudentPackages, PRESET_HOURS } from "../../hooks/useStudentPackages";
import { useBundlePoolSettings } from "../../hooks/useBundlePoolSettings";
import { childrenOf } from "../../utils/parentDirectory";
import {
  shareableCourseTypes,
  toggleSharedStudent,
  canSelectSharedStudent,
  sharedSelectionIssue,
  sharedStudentsForParent,
  packageCreatedNotice,
  packageCreateErrorMessage,
  type PackageOwnership,
} from "../../utils/sharedPackages";
import { siblingColorMap, siblingColor } from "../../utils/familyPackages";
import { formatHours } from "../../utils/formatHours";
import type { Student } from "../../types/database";

/**
 * Add hours (/admin/packages/new).
 *
 * Ownership is the first question, because everything after it differs:
 *
 *   * INDIVIDUAL — pick the student, then any course type. Bundles (Foundation
 *     Program / All-In-One) fan out into their fixed set of pools here, each
 *     created at the hours `bundle_pool_settings` defines.
 *   * SHARED — pick one of the shareable course types (Academic / Beyond
 *     Academic), then the household, then the TWO children who draw on the
 *     pool. The parent is never asked to choose; an admin assigns the pair, and
 *     a sibling left off the pool cannot spend it.
 *
 * `?parent=<id>` preselects the shared branch with that household already
 * chosen — how the family's own hours page links here.
 *
 * No money anywhere on this form: no invoice, no payment link, no proof to
 * review. The hours land immediately. Selling hours against an invoice is the
 * separate Add / Renew flow, which only ever creates individual packages.
 */
export default function AdminPackageFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();

  const { students } = useStudents();
  const { courseTypes } = useCourseTypes();
  const { createSharedPackage, createIndividualPackage } = useStudentPackages();
  const { poolDefsByBundle } = useBundlePoolSettings();

  const presetParentId = searchParams.get("parent");

  const [ownership, setOwnership] = useState<PackageOwnership>(presetParentId ? "shared" : "individual");
  const [courseTypeId, setCourseTypeId] = useState<number | "">("");
  const [parentId, setParentId] = useState<string | null>(presetParentId);
  const [sharedStudentIds, setSharedStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(PRESET_HOURS[0]);
  const [customHours, setCustomHours] = useState("");
  const [note, setNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared hours only exist for the course types sold that way; individual
  // hours can be any active one, bundles included.
  const offeredCourseTypes = useMemo(
    () => (ownership === "shared"
      ? shareableCourseTypes(courseTypes)
      : courseTypes.filter((ct) => ct.is_active)),
    [ownership, courseTypes],
  );
  const selectedCourseType = courseTypeId === "" ? null : offeredCourseTypes.find((c) => c.id === courseTypeId) ?? null;

  // Only an individual package can be a bundle — every bundle contains a
  // College Counselling pool, which is bought per student.
  const bundleDefs = ownership === "individual" && selectedCourseType
    ? poolDefsByBundle[selectedCourseType.name]
    : undefined;
  const isBundle = !!bundleDefs;

  const children = useMemo(() => childrenOf(students, parentId), [students, parentId]);
  const childColors = siblingColorMap(children.map((c) => c.id));

  // Children of a household that is no longer the selected one would be
  // rejected as members, so the picked pair is narrowed to the family on
  // screen rather than trusted as stored. Derived rather than synced back into
  // state: the stale ids are harmless as long as nothing reads them raw.
  const pickedChildIds = sharedStudentsForParent(sharedStudentIds, children);
  const selectionIssue = ownership === "shared" && parentId
    ? sharedSelectionIssue(children, pickedChildIds)
    : null;

  const hours = useMemo(() => {
    if (isBundle) return bundleDefs!.reduce((sum, d) => sum + d.hours, 0);
    return selectedPreset !== null ? selectedPreset : parseFloat(customHours);
  }, [isBundle, bundleDefs, selectedPreset, customHours]);

  const studentMatches = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) =>
        [s.id, s.first_name, s.last_name, `${s.first_name} ${s.last_name}`]
          .some((field) => field.toLowerCase().includes(q)),
      )
      .slice(0, 20);
  }, [students, studentSearch]);

  const ownerChosen = ownership === "individual" ? !!selectedStudent : !!parentId && selectionIssue === null;
  const canSubmit = Boolean(profile) && ownerChosen && courseTypeId !== "" && !!hours && hours > 0 && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !profile) return;
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
      const { error: createErr } = ownership === "shared"
        ? await createSharedPackage({
            parentId: parentId as string,
            studentIds: pickedChildIds,
            courseTypeId: p.courseTypeId as number,
            packageTypeId: p.packageTypeId,
            poolLabel: p.poolLabel,
            initialHours: p.hours,
            note: note.trim() || null,
            addedByUserId: profile.id,
          })
        : await createIndividualPackage({
            studentId: (selectedStudent as Student).id,
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
    const notice = packageCreatedNotice({
      hours,
      ownership,
      studentNames: ownership === "shared"
        ? pickedChildIds.map((id) => children.find((c) => c.id === id)?.first_name ?? id)
        : [(selectedStudent as Student).first_name],
    });
    navigate(
      ownership === "shared" ? `/admin/parents/${parentId}/packages` : "/admin/packages",
      { state: { notice } },
    );
  }

  const cancelTo = presetParentId ? `/admin/parents/${presetParentId}/packages` : "/admin/packages";

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
                  onClick={() => {
                    // The two branches offer different course types — a shared
                    // College Counselling pool is refused outright — so the
                    // pick never survives a switch.
                    setOwnership(o);
                    setCourseTypeId("");
                    setSelectedPreset(PRESET_HOURS[0]);
                    setCustomHours("");
                    setError(null);
                  }}
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

          {ownership === "individual" ? (
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
                    onClick={() => setSelectedStudent(null)}
                    className="text-xs text-navy-400 hover:text-red-500 shrink-0 ml-3"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Search by name or student ID…"
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
                          onClick={() => { setSelectedStudent(s); setStudentSearch(""); }}
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
          ) : null}

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

          {ownership === "shared" && (
            <>
              <ParentPicker
                label="Parent"
                value={parentId}
                onChange={(id) => setParentId(id)}
                returnTo="/admin/packages/new"
              />

              {parentId && (
                <div>
                  <label className="block text-xs font-medium text-navy-500 mb-1.5">Children</label>
                  {children.length === 0 ? (
                    <p className="text-sm text-navy-400">No children linked to this parent.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {children.map((c) => {
                        const picked = pickedChildIds.includes(c.id);
                        const selectable = canSelectSharedStudent(pickedChildIds, c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={!selectable}
                            onClick={() => setSharedStudentIds(toggleSharedStudent(pickedChildIds, c.id))}
                            className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                              picked
                                ? siblingColor(childColors, c.id).chip
                                : "border-navy-100 text-navy-500 hover:border-sky-200"
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full ${
                                picked ? siblingColor(childColors, c.id).dot : "bg-navy-100"
                              }`}
                            />
                            {c.first_name} {c.last_name}
                            <span className="font-mono opacity-70">{c.id}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {selectionIssue && <p className="text-xs text-navy-400 mt-2">{selectionIssue}</p>}
                </div>
              )}
            </>
          )}

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
            <Button type="button" variant="ghost" onClick={() => navigate(cancelTo)}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </AdminLayout>
  );
}
