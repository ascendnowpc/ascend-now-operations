import { useLocation, useNavigate } from "react-router-dom";
import { ParentLayout } from "./ParentLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { useAuth } from "../../context/AuthContext";
import { useMyParent, useMyChildren } from "../../hooks/useParents";
import { StudentStatusBadge } from "../../components/students/StudentStatusControls";
import { studentNeedsProfileCompletion } from "../../utils/profileCompletion";
import type { Student } from "../../types/database";

/**
 * The parent portal's front door: every child enrolled under this account.
 * One card each, opening that child's dashboard.
 *
 * This page is the reason the parent role exists as its own login rather than
 * being folded into the student dashboard — it's the one view that spans
 * siblings.
 *
 * A child whose profile is still incomplete opens straight onto the form that
 * fills it in instead of their dashboard (2026-09-17). For a young child the
 * parent is the only person who can answer any of it, and their own dashboard
 * is blocked behind the same fields until someone does.
 */
export default function ParentChildrenPage() {
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null;
  const { session } = useAuth();
  const { parent, loading: parentLoading } = useMyParent(session?.user?.id);
  const { children, loading: childrenLoading } = useMyChildren(parent?.id);

  const loading = parentLoading || childrenLoading;

  function openChild(student: Student) {
    const base = `/parent/children/${student.id}`;
    navigate(studentNeedsProfileCompletion(student) ? `${base}/details` : base);
  }

  return (
    <ParentLayout loading={loading}>
      <PageHeader
        title="My Children"
        action={
          parent ? (
            <span className="font-mono text-xs font-bold text-sky-500 bg-sky-50 border border-sky-100 px-2 py-1 rounded-lg">
              {parent.id}
            </span>
          ) : undefined
        }
      />

      {notice && (
        <p className="text-sm text-lime-700 bg-lime-50 border border-lime-100 rounded-lg px-3 py-2 mb-4">
          {notice}
        </p>
      )}

      {!parent ? (
        <Card className="p-5">
          <p className="text-sm text-navy-500">
            Your account isn't linked to a parent record yet. Please contact your Performance Coach.
          </p>
        </Card>
      ) : children.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-navy-500">
            No children are linked to your account yet. Please contact your Performance Coach.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {children.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => openChild(child)}
              className="text-left"
            >
            <Card className="p-5 h-full cursor-pointer hover:border-sky-200 hover:shadow-md transition-all">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-navy-700 truncate">
                    {child.first_name} {child.last_name}
                  </p>
                  <p className="font-mono text-xs text-sky-500 mt-0.5">{child.id}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <StudentStatusBadge status={child.status} />
                  {studentNeedsProfileCompletion(child) && (
                    <span className="rounded-pill bg-amber-50 border border-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      Details needed
                    </span>
                  )}
                </div>
              </div>
              <dl className="mt-4 flex flex-col gap-1.5 text-sm">
                {(
                  [
                    ["Curriculum", child.curriculum],
                    ["School", child.school],
                    ["Graduation", child.graduation_year != null ? String(child.graduation_year) : null],
                  ] as [string, string | null][]
                ).map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <dt className="text-navy-400 w-24 shrink-0">{label}</dt>
                    <dd className="text-navy-700 font-medium truncate">
                      {value ?? <span className="text-navy-300 italic">—</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
            </button>
          ))}
        </div>
      )}
    </ParentLayout>
  );
}
