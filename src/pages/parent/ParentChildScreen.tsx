import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ParentLayout } from "./ParentLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { useAuth } from "../../context/AuthContext";
import { useMyParent, useMyChildren } from "../../hooks/useParents";
import type { Student } from "../../types/database";

/**
 * Shared shell for every per-child parent screen: resolves the logged-in
 * parent, finds the child named in the URL among their own children, and hands
 * that record to the screen's `render`.
 *
 * Looking the child up inside the parent's OWN list is what makes a hand-typed
 * id in the address bar land on "not one of your children" rather than a blank
 * page — RLS would return nothing for someone else's child anyway, but this
 * says so plainly instead of rendering an empty dashboard.
 */
export function ParentChildScreen({
  title,
  description,
  render,
}: {
  title: string;
  description?: string;
  render: (student: Student) => ReactNode;
}) {
  const { studentId } = useParams<{ studentId: string }>();
  const { session } = useAuth();
  const { parent, loading: parentLoading } = useMyParent(session?.user?.id);
  const { children, loading: childrenLoading } = useMyChildren(parent?.id);

  const loading = parentLoading || childrenLoading;
  const student = children.find((c) => c.id === studentId) ?? null;

  return (
    <ParentLayout student={student} loading={loading}>
      <PageHeader
        title={title}
        description={description}
        action={
          student ? (
            <span className="font-mono text-xs font-bold text-sky-500 bg-sky-50 border border-sky-100 px-2 py-1 rounded-lg">
              {student.id}
            </span>
          ) : undefined
        }
      />
      {!student ? (
        <Card className="p-5">
          <p className="text-sm text-navy-500">
            {children.length === 0
              ? "No children are linked to your account yet. Please contact your Performance Coach."
              : "That student isn't one of your children."}
          </p>
        </Card>
      ) : (
        render(student)
      )}
    </ParentLayout>
  );
}
