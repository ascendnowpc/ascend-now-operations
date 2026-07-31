import { useMemo, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { StudentSearch } from "../../components/ui/StudentSearch";
import { useStudents } from "../../hooks/useStudents";
import { useTeachers } from "../../hooks/useTeachers";
import { useCcAssignments } from "../../hooks/useCcAssignments";
import { StudentStatusBadge } from "../../components/students/StudentStatusControls";
import {
  canAssignStudentToCc,
  ccAssignmentSummary,
  ccCardMatchesQuery,
  splitCcRoster,
} from "../../utils/ccAssignment";
import type { CcStudentAssignment, Student } from "../../types/database";

function initials(first: string, last?: string | null) {
  return `${first.charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase();
}

function CcStatusBadge({ status }: { status: CcStudentAssignment["status"] }) {
  const done = status === "completed";
  return (
    <span
      className={`inline-block rounded-pill px-2.5 py-0.5 text-[11px] font-semibold shrink-0 ${
        done ? "bg-navy-50 text-navy-400" : "bg-lime-100 text-lime-600"
      }`}
    >
      {done ? "Completed" : "Active"}
    </span>
  );
}

// Mirrors AdminPcAssignmentsPage, with the one structural difference between
// the two roles: a CC engagement carries its own active/completed status, so
// each card lists live students and finished ones separately instead of
// leaning on the student's own status. Completing never deletes the row — the
// student drops off the counsellor's active list but their session logs stay
// exactly where they are, listed under Completed.
export default function AdminCcAssignmentsPage() {
  const { students, loading: loadingStudents } = useStudents();
  const { teachers, loading: loadingTeachers } = useTeachers();
  const {
    assignments,
    loading: loadingAssignments,
    assignStudent,
    setAssignmentStatus,
    removeAssignment,
  } = useCcAssignments();

  const counsellors = teachers.filter((t) => t.is_college_counselor && t.is_active);
  const loading = loadingStudents || loadingTeachers || loadingAssignments;

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [saving, setSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  function toggleExpand(ccId: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(ccId)) n.delete(ccId);
      else n.add(ccId);
      return n;
    });
  }

  const studentById = new Map(students.map((s) => [s.id, s]));
  // Card contents, the stat tiles, the assign guard and the search all live in
  // src/utils/ccAssignment.ts so the rules are unit-testable away from React
  // and Supabase — see ccAssignment.test.ts.
  const summary = ccAssignmentSummary(assignments, students.length);

  function studentLabel(studentId: string): string | null {
    const s = studentById.get(studentId);
    return s ? `${s.id} ${s.first_name} ${s.last_name}` : null;
  }

  async function handleAssign(ccId: string) {
    if (!selectedStudent) return;
    const check = canAssignStudentToCc(assignments, selectedStudent.id);
    if (!check.ok) {
      setAssignError(`${selectedStudent.first_name} ${selectedStudent.last_name} already has an active CC.`);
      return;
    }
    setSaving(true);
    setAssignError(null);
    const { error } = await assignStudent(selectedStudent.id, ccId);
    setSaving(false);
    if (error) {
      setAssignError(error);
      return;
    }
    setAddingFor(null);
    setSelectedStudent(null);
    setExpanded((s) => new Set(s).add(ccId));
  }

  function openAdd(ccId: string) {
    setAddingFor(ccId);
    setSelectedStudent(null);
    setAssignError(null);
    setExpanded((s) => new Set(s).add(ccId));
  }

  function cancelAdd() {
    setAddingFor(null);
    setSelectedStudent(null);
    setAssignError(null);
  }

  const visibleCounsellors = useMemo(
    () =>
      counsellors.filter((cc) =>
        ccCardMatchesQuery({ query: search, counsellor: cc, assignments, studentLabel })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [counsellors, search, assignments, students]
  );

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center gap-2 text-navy-300 py-12"><Spinner /> Loading…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <PageHeader
        title="CC Assignments"
        description="Each College Counsellor card shows their current students. Expand a counsellor to manage."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card className="p-4">
          <p className="text-xs text-navy-400">College counsellors</p>
          <p className="text-2xl font-bold text-navy-700 mt-1">{counsellors.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-400">Total students</p>
          <p className="text-2xl font-bold text-navy-700 mt-1">{summary.totalStudents}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-400">With a CC</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{summary.withCc}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-400">Completed</p>
          <p className="text-2xl font-bold text-navy-700 mt-1">{summary.completed}</p>
        </Card>
      </div>

      {counsellors.length > 0 && (
        <div className="mb-5">
          <input
            type="text"
            placeholder="Search by counsellor or student name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm rounded-xl border border-navy-100 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>
      )}

      {counsellors.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-navy-400">No College Counsellors found. Mark teachers as counsellors first.</p>
        </Card>
      ) : visibleCounsellors.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-navy-400">No counsellors or students match "{search}".</p>
        </Card>
      ) : (
        <div className="columns-1 lg:columns-2 gap-5">
          {visibleCounsellors.map((cc) => {
            const { active, completed } = splitCcRoster(assignments, cc.id);

            const isExpanded = expanded.has(cc.id);
            const isAdding = addingFor === cc.id;

            function renderRow(a: CcStudentAssignment) {
              const s = studentById.get(a.student_id);
              if (!s) return null;
              const isDone = a.unassigned_at !== null;
              return (
                <div key={a.id} className="flex items-center justify-between py-2 px-2.5 rounded-lg hover:bg-white transition-colors group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                      {initials(s.first_name, s.last_name)}
                    </div>
                    <span className="font-mono text-xs font-bold text-sky-500 shrink-0">{s.id}</span>
                    <span className="text-sm text-navy-700 truncate">{s.first_name} {s.last_name}</span>
                    <CcStatusBadge status={a.status} />
                    <StudentStatusBadge status={s.status} />
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    {isDone ? (
                      <button
                        onClick={() => setAssignmentStatus(a.id, "active")}
                        className="text-xs text-sky-500 hover:text-sky-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Reopen
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => setAssignmentStatus(a.id, "completed")}
                          className="text-xs text-navy-400 hover:text-navy-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Mark complete
                        </button>
                        {/* Deletes the row outright — for an assignment made
                            by mistake. Ending a real engagement is "Mark
                            complete", which keeps the history. */}
                        <button
                          onClick={() => removeAssignment(a.id)}
                          className="text-xs text-red-400 hover:text-red-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <Card key={cc.id} className="overflow-hidden flex flex-col hover:shadow-md transition-shadow mb-5 break-inside-avoid">
                <button
                  onClick={() => toggleExpand(cc.id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-navy-50/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-navy-500 to-navy-700 text-white flex items-center justify-center text-sm font-bold shrink-0">
                      {initials(cc.first_name, cc.last_name)}
                    </div>
                    <div className="min-w-0 text-left">
                      <p className="font-semibold text-navy-700 truncate">
                        {cc.first_name} {cc.last_name ?? ""}
                      </p>
                      <p className="text-xs text-navy-400">College Counsellor</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs bg-sky-50 text-sky-600 border border-sky-100 px-2.5 py-1 rounded-full font-medium">
                      {active.length} student{active.length !== 1 ? "s" : ""}
                    </span>
                    <span className={`text-navy-400 text-xs transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-navy-50 px-5 py-3 space-y-1 bg-slate-50/40">
                    {active.length === 0 ? (
                      <p className="text-sm text-navy-400 py-3 text-center">No students assigned yet.</p>
                    ) : (
                      active.map(renderRow)
                    )}

                    {isAdding ? (
                      <div className="pt-3 mt-2 border-t border-navy-100 space-y-2">
                        <StudentSearch
                          label="Search student to assign"
                          value={selectedStudent?.id ?? null}
                          onChange={(s) => { setSelectedStudent(s); setAssignError(null); }}
                        />
                        {assignError && (
                          <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-lg">{assignError}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          <button
                            onClick={() => handleAssign(cc.id)}
                            disabled={saving || !selectedStudent}
                            className="text-sm bg-sky-500 hover:bg-sky-600 text-white font-medium disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            {saving ? "Saving…" : "Assign"}
                          </button>
                          <button onClick={cancelAdd} className="text-sm text-navy-400 hover:text-navy-600">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => openAdd(cc.id)}
                        className="text-sm text-sky-500 hover:text-sky-700 font-medium pt-3 mt-1 border-t border-navy-100 w-full text-left flex items-center gap-1"
                      >
                        + Assign student
                      </button>
                    )}

                    {completed.length > 0 && (
                      <div className="pt-3 mt-1 border-t border-navy-100">
                        <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-1">Completed</p>
                        {completed.map(renderRow)}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}
