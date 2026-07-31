import { useMemo, useState } from "react";
import { TeacherLayout } from "./TeacherLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { DataTable, type ColumnDef } from "../../components/ui/DataTable";
import { useCcAssignments } from "../../hooks/useCcAssignments";
import { useMyTeacherProfile } from "../../hooks/useMyTeacherProfile";
import { useStudents } from "../../hooks/useStudents";
import {
  CC_ASSIGNMENT_STATUSES,
  CC_ASSIGNMENT_STATUS_LABEL,
  ccRosterRowMatches,
  ccRosterRows,
  type CcRosterRow,
} from "../../utils/ccAssignment";
import type { CcAssignmentStatus } from "../../types/database";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/**
 * A College Counsellor's "My Students".
 *
 * Deliberately NOT the shared `StudentsListView` the admin and PC pages use.
 * That table is built around data a counsellor has no business with and, more
 * to the point, no RLS access to — the username column reads `users`, the
 * package-status filter reads `student_packages`, and a CC has no policy on
 * either, so most of its eighteen columns render as "—" for them. Its tabs
 * also filter by the *student's* Active/On pause/Completed status, which is
 * independent of the counselling engagement: a counsellor who had finished
 * with an active student saw them sitting under "Active" with no sign the
 * engagement was over, and their own completed work was nowhere.
 *
 * This list shows the one thing that is actually theirs: their engagements,
 * tabbed by the engagement's own status.
 */
export default function TeacherCcStudentsPage() {
  const { assignments, loading: assignmentsLoading, error } = useCcAssignments();
  const { teacher, loading: teacherLoading } = useMyTeacherProfile();
  const { students, loading: studentsLoading } = useStudents();

  const [tab, setTab] = useState<CcAssignmentStatus>("active");
  const [search, setSearch] = useState("");

  // Everything below depends on all three loads, so wait for the lot rather
  // than rendering a roster built from half-arrived data — that flicker
  // ("no students assigned" → the real list) was what made this page feel
  // unstable. Memoised on the raw inputs so the rows keep a stable identity
  // between renders instead of being rebuilt on every keystroke elsewhere.
  const loading = assignmentsLoading || teacherLoading || studentsLoading;

  const rows = useMemo(
    () => (teacher ? ccRosterRows(assignments, students, teacher.id) : []),
    [assignments, students, teacher]
  );

  const countByStatus = useMemo(
    () => ({
      active: rows.filter((r) => r.status === "active").length,
      completed: rows.filter((r) => r.status === "completed").length,
    }),
    [rows]
  );

  const visible = useMemo(
    () => rows.filter((r) => r.status === tab && ccRosterRowMatches(r, search)),
    [rows, tab, search]
  );

  const columns: ColumnDef<CcRosterRow>[] = [
    {
      header: "ID",
      accessor: (r) => <span className="font-mono text-xs font-semibold text-sky-500">{r.studentId}</span>,
      className: "whitespace-nowrap",
    },
    { header: "First name", accessor: (r) => r.firstName },
    { header: "Last name", accessor: (r) => r.lastName },
    { header: "Assigned", accessor: (r) => formatDate(r.assignedAt), className: "whitespace-nowrap" },
    {
      header: "Completed",
      accessor: (r) => formatDate(r.unassignedAt),
      className: "whitespace-nowrap",
    },
  ];

  if (loading) {
    return (
      <TeacherLayout>
        <PageHeader title="My Students" description="Students assigned to you as their College Counsellor." />
        <div className="flex items-center gap-2 text-navy-300 py-12"><Spinner /> Loading…</div>
      </TeacherLayout>
    );
  }

  return (
    <TeacherLayout>
      <PageHeader title="My Students" description="Students assigned to you as their College Counsellor." />

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}

      <div className="flex gap-0 border-b border-navy-100 mb-5">
        {CC_ASSIGNMENT_STATUSES.map((status) => (
          <button
            key={status}
            onClick={() => setTab(status)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === status
                ? "border-sky-500 text-sky-600"
                : "border-transparent text-navy-400 hover:text-navy-600 hover:border-navy-200"
            }`}
          >
            {CC_ASSIGNMENT_STATUS_LABEL[status]} ({countByStatus[status]})
          </button>
        ))}
      </div>

      {rows.length > 0 && (
        <Card className="p-4 mb-5">
          <input
            type="text"
            placeholder="Search by name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm rounded-xl border border-navy-100 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={visible}
        getRowId={(r) => r.assignmentId}
        emptyMessage={
          tab === "active"
            ? "No students are assigned to you yet."
            : "You haven't completed any students yet."
        }
      />
    </TeacherLayout>
  );
}
