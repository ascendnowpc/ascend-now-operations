import { useNavigate } from "react-router-dom";
import { ParentLayout } from "./ParentLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { useAuth } from "../../context/AuthContext";
import { useMyParent, useMyChildren } from "../../hooks/useParents";
import { StudentStatusBadge } from "../../components/students/StudentStatusControls";
import type { Student } from "../../types/database";

/**
 * The parent portal's front door: every child enrolled under this account.
 * One card each, opening that child's dashboard.
 *
 * This page is the reason the parent role exists as its own login rather than
 * being folded into the student dashboard — it's the one view that spans
 * siblings.
 */
export default function ParentChildrenPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parent, loading: parentLoading } = useMyParent(session?.user?.id);
  const { children, loading: childrenLoading } = useMyChildren(parent?.id);

  const loading = parentLoading || childrenLoading;

  function openChild(student: Student) {
    navigate(`/parent/children/${student.id}`);
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
                <StudentStatusBadge status={child.status} />
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
