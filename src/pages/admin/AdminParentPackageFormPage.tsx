import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { useAuth } from "../../context/AuthContext";
import { useParents } from "../../hooks/useParents";
import { useStudents } from "../../hooks/useStudents";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useStudentPackages, PRESET_HOURS } from "../../hooks/useStudentPackages";
import { useBundlePoolSettings } from "../../hooks/useBundlePoolSettings";
import { childrenOf, parentDisplayName } from "../../utils/parentDirectory";
import { formatHours } from "../../utils/formatHours";

/**
 * Add hours to a family (/admin/parents/:id/packages/new).
 *
 * The same course-type + hours choice the enroll form offers, minus everything
 * about money: no invoice, no payment link, no proof to upload and review. The
 * hours land on the parent immediately and every one of their children can
 * start drawing on them.
 *
 * Bundles (Foundation Program / All-In-One) fan out into their fixed set of
 * pools exactly as they do for a student, each created as its own family pool
 * at the hours `bundle_pool_settings` defines.
 */
export default function AdminParentPackageFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const { parents } = useParents();
  const { students } = useStudents();
  const { courseTypes } = useCourseTypes();
  const { createFamilyPackage } = useStudentPackages();
  const { poolDefsByBundle } = useBundlePoolSettings();

  const parent = parents.find((p) => p.id === id) ?? null;
  const children = childrenOf(students, id);

  const [courseTypeId, setCourseTypeId] = useState<number | "">("");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(PRESET_HOURS[0]);
  const [customHours, setCustomHours] = useState("");
  const [note, setNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCourseTypes = courseTypes.filter((ct) => ct.is_active);
  const selectedCourseType = courseTypeId === "" ? null : activeCourseTypes.find((c) => c.id === courseTypeId) ?? null;
  const bundleDefs = selectedCourseType ? poolDefsByBundle[selectedCourseType.name] : undefined;
  const isBundle = !!bundleDefs;

  const hours = useMemo(() => {
    if (isBundle) return bundleDefs!.reduce((sum, d) => sum + d.hours, 0);
    return selectedPreset !== null ? selectedPreset : parseFloat(customHours);
  }, [isBundle, bundleDefs, selectedPreset, customHours]);

  const canSubmit = Boolean(profile) && courseTypeId !== "" && !!hours && hours > 0 && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !profile || !id) return;
    setSaving(true);
    setError(null);

    // A bundle is several pools, each with its own real deducting course type
    // and its own fixed hours, grouped under the bundle via package_type_id —
    // the same shape review-enrollment-payment builds for a student.
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
      const { error: createErr } = await createFamilyPackage({
        parentId: id,
        courseTypeId: p.courseTypeId as number,
        packageTypeId: p.packageTypeId,
        poolLabel: p.poolLabel,
        initialHours: p.hours,
        note: note.trim() || null,
        addedByUserId: profile.id,
      });
      if (createErr) {
        setSaving(false);
        setError(`"${p.label}" failed: ${createErr}`);
        return;
      }
    }

    setSaving(false);
    navigate(`/admin/parents/${id}/packages`, {
      state: {
        notice: `${formatHours(hours)} hrs added${
          children.length > 0 ? ` — shared by ${children.map((c) => c.first_name).join(" and ")}` : ""
        }.`,
      },
    });
  }

  return (
    <AdminLayout>
      <PageHeader title={parent ? `Add package — ${parentDisplayName(parent)}` : "Add package"} />

      <Card className="p-6 max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <SelectInput
            label="Course type"
            placeholder="Select…"
            value={courseTypeId === "" ? "" : String(courseTypeId)}
            onChange={(e) => {
              setCourseTypeId(e.target.value === "" ? "" : Number(e.target.value));
              setSelectedPreset(PRESET_HOURS[0]);
              setCustomHours("");
            }}
            options={activeCourseTypes.map((ct) => ({ value: String(ct.id), label: ct.name }))}
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

          {children.length > 0 && (
            <p className="text-xs text-navy-400">
              Shared by {children.map((c) => `${c.first_name} ${c.last_name}`.trim()).join(", ")}.
            </p>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 mt-2">
            <Button type="submit" disabled={!canSubmit}>
              {saving ? "Adding…" : "Add package"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate(`/admin/parents/${id}/packages`)}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </AdminLayout>
  );
}
