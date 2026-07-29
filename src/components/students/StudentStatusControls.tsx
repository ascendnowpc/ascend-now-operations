import { useState } from "react";
import { RowMenu } from "../ui/RowMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Toast } from "../ui/Toast";
import { setStudentStatus } from "../../hooks/useStudents";
import {
  STUDENT_STATUSES,
  STUDENT_STATUS_LABEL,
  normalizeStudentStatus,
  studentStatusBadgeClass,
} from "../../utils/studentStatus";
import type { Student, StudentStatus } from "../../types/database";

export function StudentStatusBadge({ status }: { status: string | null | undefined }) {
  const s = normalizeStudentStatus(status);
  return (
    <span className={`inline-block whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${studentStatusBadgeClass(s)}`}>
      {STUDENT_STATUS_LABEL[s]}
    </span>
  );
}

/**
 * Moves a student between Active / On pause / Completed. Used by both the admin
 * and the performance-coach views (the shared students list and the shared
 * student detail view) — the same three options, the same confirmation, for
 * both roles.
 *
 * Completing is confirmed first because it also unassigns the student from
 * their coach (the `set_student_status` RPC closes the assignment), which a
 * coach cannot undo themselves — only an admin can re-assign afterwards.
 */
export function StudentStatusMenu({
  student,
  onChanged,
}: {
  student: Pick<Student, "id" | "first_name" | "last_name" | "status">;
  onChanged?: (updated: Student) => void;
}) {
  const current = normalizeStudentStatus(student.status);
  const [pendingComplete, setPendingComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(status: StudentStatus) {
    const { data, error } = await setStudentStatus(student.id, status);
    if (error) {
      setError(error);
      return;
    }
    if (data) onChanged?.(data);
  }

  const actions = STUDENT_STATUSES.filter((s) => s !== current).map((s) => ({
    label: STUDENT_STATUS_LABEL[s],
    onClick: () => (s === "completed" ? setPendingComplete(true) : apply(s)),
  }));

  return (
    <>
      <RowMenu actions={actions} />
      <ConfirmDialog
        open={pendingComplete}
        title="Mark as completed?"
        description={`${student.first_name} ${student.last_name} will move to Completed and be unassigned from their Performance Coach.`}
        confirmLabel="Mark completed"
        onCancel={() => setPendingComplete(false)}
        onConfirm={() => {
          setPendingComplete(false);
          apply("completed");
        }}
      />
      {error && <Toast message={error} variant="error" onDismiss={() => setError(null)} />}
    </>
  );
}
