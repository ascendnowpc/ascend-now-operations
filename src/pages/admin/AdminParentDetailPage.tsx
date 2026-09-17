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
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useAllPackages } from "../../hooks/useStudentPackages";
import { useFamilyPackageUsage } from "../../hooks/useFamilyPackageUsage";
import { childrenOf, parentDisplayName } from "../../utils/parentDirectory";
import { siblingColorMap, siblingColor, individualPackageUsage } from "../../utils/familyPackages";
import {
  householdPackages,
  packagesForStudent,
  packageStudentIds,
  isSharedPackage,
  totalPackageHours,
} from "../../utils/householdPackages";
import { formatHours } from "../../utils/formatHours";
import type { StudentPackage } from "../../types/database";

/**
 * One household, whole (/admin/parents/:id).
 *
 * The parent's own details, every child, and every package the family holds —
 * each child's own alongside the ones they share — because "what has this
 * family bought" was previously answerable only by opening each child's page in
 * turn and remembering that shared pools appear on neither.
 *
 * A shared pool is listed under BOTH children who draw on it, marked as shared
 * and with the colour-coded split of who spent what; the household total counts
 * it once, so the per-child lists and the total can't disagree.
 *
 * Every pool gets a usage bar, individual ones included (2026-09-17). The bar
 * used to be the shared pools' alone, which read as if an individual pool had
 * nothing to show — its hours simply have one owner, and that owner is the
 * child whose card it sits on, so it draws in that child's colour with the
 * per-child legend left off (the line above the bar already says whose it is).
 */
export default function AdminParentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;

  const { parents, loading: parentsLoading } = useParents();
  const { students } = useStudents();
  const { courseTypes } = useCourseTypes();
  const { packages, members, loading: packagesLoading } = useAllPackages();

  const parent = parents.find((p) => p.id === id) ?? null;
  const children = childrenOf(students, id);
  const colors = siblingColorMap(children.map((c) => c.id));

  // Not memoised: `children` is a fresh array each render, so a useMemo over it
  // would never hit anyway, and filtering a handful of packages is cheaper than
  // the bookkeeping. `useFamilyPackageUsage` keys on the joined ids, so the new
  // array below doesn't re-fetch either.
  const familyPackages = householdPackages(packages, members, children.map((c) => c.id));
  const sharedPackages = familyPackages.filter(isSharedPackage);
  const { usageByPackage } = useFamilyPackageUsage(sharedPackages.map((p) => p.id));

  const totals = totalPackageHours(familyPackages);

  const courseTypeName = (ctId: number | null) =>
    (ctId != null ? courseTypes.find((c) => c.id === ctId)?.name : undefined) ?? "Package";

  function packageTitle(p: StudentPackage) {
    return `${courseTypeName(p.course_type_id)}${p.pool_label ? ` · ${p.pool_label}` : ""}`;
  }

  function sharedWithNames(p: StudentPackage, exceptStudentId: string) {
    return packageStudentIds(p, members)
      .filter((sid) => sid !== exceptStudentId)
      .map((sid) => children.find((c) => c.id === sid)?.first_name ?? sid)
      .join(" and ");
  }

  return (
    <AdminLayout>
      <PageHeader
        title={parent ? parentDisplayName(parent) : "Parent"}
        action={
          <div className="flex gap-2">
            <Button
              className="flex items-center gap-2"
              onClick={() => navigate(`/admin/packages/new?parent=${id}`)}
            >
              <IconPlus /> Add package
            </Button>
            <Button variant="ghost" onClick={() => navigate(`/admin/parents/${id}/edit`)}>
              Edit
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
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-navy-300">ID</dt>
                <dd className="mt-0.5 font-mono text-navy-700">{parent.id}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-navy-300">Status</dt>
                <dd className="mt-0.5">
                  <span
                    className={`inline-block rounded-pill px-3 py-0.5 text-xs font-semibold ${
                      parent.is_active ? "bg-lime-100 text-lime-600" : "bg-navy-50 text-navy-300"
                    }`}
                  >
                    {parent.is_active ? "Active" : "Inactive"}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-navy-300">Email</dt>
                <dd className="mt-0.5 text-navy-700">{parent.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-navy-300">Phone</dt>
                <dd className="mt-0.5 text-navy-700">{parent.phone_number ?? "—"}</dd>
              </div>
            </dl>
          </Card>

          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4">
              <p className="text-xs text-navy-400">Hours bought</p>
              <p className="text-2xl font-bold text-navy-700 mt-1">{formatHours(totals.purchased)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-navy-400">Hours used</p>
              <p className="text-2xl font-bold text-navy-700 mt-1">{formatHours(totals.used)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-navy-400">Hours left</p>
              <p className="text-2xl font-bold text-navy-700 mt-1">{formatHours(totals.remaining)}</p>
            </Card>
          </div>

          {packagesLoading ? (
            <Card className="p-5">
              <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
            </Card>
          ) : children.length === 0 ? (
            <Card className="p-5">
              <p className="text-sm text-navy-400">No children linked yet.</p>
            </Card>
          ) : (
            children.map((child) => {
              const childPackages = packagesForStudent(packages, members, child.id);
              return (
                <Card key={child.id} className="p-5">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/students/${child.id}`)}
                      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-sm font-semibold transition-opacity hover:opacity-80 ${
                        siblingColor(colors, child.id).chip
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${siblingColor(colors, child.id).dot}`} />
                      {child.first_name} {child.last_name}
                      <span className="font-mono text-xs opacity-70">{child.id}</span>
                    </button>
                    <span className="text-xs text-navy-400 tabular-nums">
                      {formatHours(totalPackageHours(childPackages).remaining)} hrs left
                    </span>
                  </div>

                  {childPackages.length === 0 ? (
                    <p className="text-sm text-navy-400">No packages.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {childPackages.map((p) => {
                        const shared = isSharedPackage(p);
                        const remaining = Math.max(
                          (p.total_hours_purchased ?? 0) - (p.hours_used ?? 0),
                          0,
                        );
                        return (
                          <div key={p.id} className="rounded-xl border border-navy-50 p-3.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-navy-700">
                                  {packageTitle(p)}
                                  {shared && (
                                    <span className="ml-2 rounded-pill bg-sky-50 border border-sky-100 px-2 py-0.5 text-xs font-medium text-sky-600">
                                      Shared with {sharedWithNames(p, child.id) || "a sibling"}
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-navy-400 mt-0.5">
                                  {formatHours(p.hours_used ?? 0)} of{" "}
                                  {formatHours(p.total_hours_purchased ?? 0)} hrs used ·{" "}
                                  <span className="font-semibold text-navy-600">
                                    {formatHours(remaining)} hrs left
                                  </span>
                                </p>
                              </div>
                              {p.is_locked && (
                                <span className="rounded-pill bg-navy-50 text-navy-400 px-2.5 py-0.5 text-xs font-semibold shrink-0">
                                  Locked
                                </span>
                              )}
                            </div>

                            <div className="mt-3">
                              <FamilyUsageBar
                                usage={
                                  shared
                                    ? usageByPackage.get(p.id) ?? []
                                    : individualPackageUsage(p, child)
                                }
                                purchasedHours={p.total_hours_purchased ?? 0}
                                colors={colors}
                                showLegend={shared}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}
    </AdminLayout>
  );
}
