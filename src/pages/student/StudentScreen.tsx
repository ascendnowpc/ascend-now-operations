import type { ReactNode } from "react";
import { StudentLayout } from "./StudentLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { useMyStudent } from "../../hooks/useMyStudent";
import type { Student } from "../../types/database";

// Shared shell for the three student portal screens — resolves the logged-in
// student's own record once, then hands it to each screen's `render`.
export function StudentScreen({
  title,
  description,
  render,
}: {
  title: string;
  description?: string;
  render: (student: Student) => ReactNode;
}) {
  const { student, loading } = useMyStudent();

  return (
    <StudentLayout>
      <PageHeader
        title={title}
        description={description}
        action={student ? (
          <span className="font-mono text-xs font-bold text-sky-500 bg-sky-50 border border-sky-100 px-2 py-1 rounded-lg">{student.id}</span>
        ) : undefined}
      />
      {loading ? (
        <div className="flex items-center gap-2 text-navy-300 py-12"><Spinner /> Loading…</div>
      ) : !student ? (
        <Card className="p-5">
          <p className="text-sm text-navy-500">Your account isn't linked to a student record yet. Please contact your Performance Coach.</p>
        </Card>
      ) : (
        render(student)
      )}
    </StudentLayout>
  );
}
