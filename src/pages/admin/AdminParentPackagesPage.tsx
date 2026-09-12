import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { IconPlus } from "../../components/ui/icons";
import { FamilyUsageBar } from "../../components/students/FamilyUsageBar";
import { useParents } from "../../hooks/useParents";
import { useStudents } from "../../hooks/useStudents";
import { useStudentPackages } from "../../hooks/useStudentPackages";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useFamilyPackageUsage } from "../../hooks/useFamilyPackageUsage";
import { childrenOf, parentDisplayName } from "../../utils/parentDirectory";
import { siblingColorMap, siblingColor } from "../../utils/familyPackages";
import { formatHours } from "../../utils/formatHours";
import type { PackageTopup, StudentPackage } from "../../types/database";

type PackageWithTopups = StudentPackage & { package_topups: PackageTopup[] };

/**
 * A family's hours: the packages a parent bought, and which child spent them.
 *
 * Each pool is shared by the two children named on it — 50 Academic hours
 * bought once are 50 hours those two share, not 25 each. The card shows the
 * balance and a colour-coded split of who used what, so "40 of 50 used" is
 * answerable without opening two students' session logs, and a named child who
 * has spent nothing still shows, at zero: the usage RPC returns every member.
 */
export default function AdminParentPackagesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;

  const { parents, loading: parentsLoading } = useParents();
  const { students } = useStudents();
  const { courseTypes } = useCourseTypes();
  const { fetchPackagesForParent } = useStudentPackages();

  const parent = parents.find((p) => p.id === id) ?? null;
  const children = childrenOf(students, id);
  const colors = siblingColorMap(children.map((c) => c.id));

  const [packages, setPackages] = useState<PackageWithTopups[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const rows = await fetchPackagesForParent(id);
    setPackages(rows);
    setLoading(false);
  }, [id, fetchPackagesForParent]);

  useEffect(() => { load(); }, [load]);

  const { usageByPackage } = useFamilyPackageUsage(packages.map((p) => p.id));

  const courseTypeName = (ctId: number | null) =>
    (ctId != null ? courseTypes.find((c) => c.id === ctId)?.name : undefined) ?? "Package";

  return (
    <AdminLayout>
      <PageHeader
        title={parent ? `${parentDisplayName(parent)} — Hours` : "Family hours"}
        action={
          <div className="flex gap-2">
            <Button
              className="flex items-center gap-2"
              onClick={() => navigate(`/admin/packages/new?parent=${id}`)}
            >
              <IconPlus /> Add package
            </Button>
            <Button variant="ghost" onClick={() => navigate("/admin/parents")}>
              Back to parents
            </Button>
          </div>
        }
      />

      {notice && (
        <p className="text-sm text-lime-700 bg-lime-50 border border-lime-100 rounded-lg px-3 py-2 mb-4">
          {notice}
        </p>
      )}

      {parentsLoading && !parent ? (
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      ) : !parent ? (
        <Card className="p-5">
          <p className="text-sm text-navy-500">That parent no longer exists.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-5 max-w-3xl">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-navy-700 mb-3">Children</h3>
            {children.length === 0 ? (
              <p className="text-sm text-navy-400">No children linked yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {children.map((c) => (
                  <span
                    key={c.id}
                    className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-medium ${
                      siblingColor(colors, c.id).chip
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${siblingColor(colors, c.id).dot}`} />
                    {c.first_name} {c.last_name}
                    <span className="font-mono opacity-70">{c.id}</span>
                  </span>
                ))}
              </div>
            )}
          </Card>

          {loading ? (
            <Card className="p-5">
              <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
            </Card>
          ) : packages.length === 0 ? (
            <Card className="p-5">
              <p className="text-sm text-navy-400">No family packages yet.</p>
            </Card>
          ) : (
            packages.map((p) => {
              const usage = usageByPackage.get(p.id) ?? [];
              const remaining = Math.max((p.total_hours_purchased ?? 0) - (p.hours_used ?? 0), 0);
              return (
                <Card key={p.id} className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-base font-semibold text-navy-700">
                        {courseTypeName(p.course_type_id)}
                        {p.pool_label ? <span className="text-navy-400"> · {p.pool_label}</span> : null}
                      </p>
                      <p className="text-xs text-navy-400 mt-0.5">
                        {formatHours(p.hours_used ?? 0)} of {formatHours(p.total_hours_purchased ?? 0)} hrs used
                        {" · "}
                        <span className="font-semibold text-navy-600">{formatHours(remaining)} hrs left</span>
                      </p>
                    </div>
                    {p.is_locked && (
                      <span className="rounded-pill bg-navy-50 text-navy-400 px-2.5 py-0.5 text-xs font-semibold">
                        Locked
                      </span>
                    )}
                  </div>

                  <FamilyUsageBar
                    usage={usage}
                    purchasedHours={p.total_hours_purchased ?? 0}
                    colors={colors}
                  />
                </Card>
              );
            })
          )}
        </div>
      )}
    </AdminLayout>
  );
}
