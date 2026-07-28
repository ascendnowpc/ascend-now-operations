import { useMemo, useState } from "react";
import { AdminLayout } from "./AdminLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { StudentSearch } from "../../components/ui/StudentSearch";
import { useStudents } from "../../hooks/useStudents";
import { useTeachers } from "../../hooks/useTeachers";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { PcAssignmentReport } from "../../components/pc/PcAssignmentReport";
import type { Student } from "../../types/database";

function initials(first: string, last?: string | null) {
  return `${first.charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase();
}

export default function AdminPcAssignmentsPage() {
  const { students, loading: loadingStudents } = useStudents();
  const { teachers, loading: loadingTeachers } = useTeachers();
  const {
    activeAssignments,
    loading: loadingAssignments,
    assignStudent,
    unassignStudent,
  } = usePcAssignments();

  const coaches = teachers.filter((t) => t.is_performance_coach && t.is_active);
  const loading = loadingStudents || loadingTeachers || loadingAssignments;

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [addingFor, setAddingFor] = useState<number | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [saving, setSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  function toggleExpand(pcId: number) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(pcId) ? n.delete(pcId) : n.add(pcId);
      return n;
    });
  }

  const assignedIds = new Set(activeAssignments.map((a) => a.student_id));

  async function handleAssign(pcId: number) {
    if (!selectedStudent) return;
    if (assignedIds.has(selectedStudent.id)) {
      setAssignError(`${selectedStudent.first_name} ${selectedStudent.last_name} is already assigned to a PC.`);
      return;
    }
    setSaving(true);
    setAssignError(null);
    await assignStudent(selectedStudent.id, pcId);
    setSaving(false);
    setAddingFor(null);
    setSelectedStudent(null);
    setExpanded((s) => new Set(s).add(pcId));
  }

  async function handleUnassign(studentId: string) {
    await unassignStudent(studentId);
  }

  function openAdd(pcId: number) {
    setAddingFor(pcId);
    setSelectedStudent(null);
    setAssignError(null);
    setExpanded((s) => new Set(s).add(pcId));
  }

  function cancelAdd() {
    setAddingFor(null);
    setSelectedStudent(null);
    setAssignError(null);
  }

  const q = search.trim().toLowerCase();
  const visibleCoaches = useMemo(() => {
    if (!q) return coaches;
    return coaches.filter((pc) => {
      const nameMatch = `${pc.first_name} ${pc.last_name ?? ""}`.toLowerCase().includes(q);
      if (nameMatch) return true;
      const studentMatch = activeAssignments
        .filter((a) => a.pc_teacher_id === pc.id)
        .some((a) => {
          const stu = students.find((s) => s.id === a.student_id);
          return stu && (`${stu.first_name} ${stu.last_name}`.toLowerCase().includes(q) || stu.id.toLowerCase().includes(q));
        });
      return studentMatch;
    });
  }, [coaches, q, activeAssignments, students]);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center gap-2 text-navy-300 py-12"><Spinner /> Loading…</div>
      </AdminLayout>
    );
  }

  const unassignedCount = students.filter((s) => !assignedIds.has(s.id)).length;
  const assignedCount = students.length - unassignedCount;

  return (
    <AdminLayout>
      <PageHeader
        title="PC Assignments"
        description="Each Performance Coach card shows their current students. Expand a coach to manage."
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card className="p-4">
          <p className="text-xs text-navy-400">Performance coaches</p>
          <p className="text-2xl font-bold text-navy-700 mt-1">{coaches.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-400">Total students</p>
          <p className="text-2xl font-bold text-navy-700 mt-1">{students.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-400">Assigned</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{assignedCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-navy-400">Unassigned</p>
          <p className={`text-2xl font-bold mt-1 ${unassignedCount > 0 ? "text-yellow-600" : "text-navy-700"}`}>{unassignedCount}</p>
        </Card>
      </div>

      {coaches.length > 0 && (
        <div className="mb-5">
          <input
            type="text"
            placeholder="Search by coach or student name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm rounded-xl border border-navy-100 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
        </div>
      )}

      {coaches.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-navy-400">No Performance Coaches found. Mark teachers as coaches first.</p>
        </Card>
      ) : visibleCoaches.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-navy-400">No coaches or students match "{search}".</p>
        </Card>
      ) : (
        <div className="columns-1 lg:columns-2 gap-5">
          {visibleCoaches.map((pc) => {
            const assigned = activeAssignments
              .filter((a) => a.pc_teacher_id === pc.id)
              .map((a) => students.find((s) => s.id === a.student_id))
              .filter(Boolean) as typeof students;

            const isExpanded = expanded.has(pc.id);
            const isAdding = addingFor === pc.id;

            return (
              <Card key={pc.id} className="overflow-hidden flex flex-col hover:shadow-md transition-shadow mb-5 break-inside-avoid">
                <button
                  onClick={() => toggleExpand(pc.id)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-navy-50/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-navy-500 to-navy-700 text-white flex items-center justify-center text-sm font-bold shrink-0">
                      {initials(pc.first_name, pc.last_name)}
                    </div>
                    <div className="min-w-0 text-left">
                      <p className="font-semibold text-navy-700 truncate">
                        {pc.first_name} {pc.last_name ?? ""}
                      </p>
                      <p className="text-xs text-navy-400">Performance Coach</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs bg-sky-50 text-sky-600 border border-sky-100 px-2.5 py-1 rounded-full font-medium">
                      {assigned.length} student{assigned.length !== 1 ? "s" : ""}
                    </span>
                    <span className={`text-navy-400 text-xs transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-navy-50 px-5 py-3 space-y-1 bg-slate-50/40">
                    {assigned.length === 0 ? (
                      <p className="text-sm text-navy-400 py-3 text-center">No students assigned yet.</p>
                    ) : (
                      assigned.map((s) => (
                        <div key={s.id} className="flex items-center justify-between py-2 px-2.5 rounded-lg hover:bg-white transition-colors group">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                              {initials(s.first_name, s.last_name)}
                            </div>
                            <span className="font-mono text-xs font-bold text-sky-500 shrink-0">{s.id}</span>
                            <span className="text-sm text-navy-700 truncate">{s.first_name} {s.last_name}</span>
                          </div>
                          <button
                            onClick={() => handleUnassign(s.id)}
                            className="text-xs text-red-400 hover:text-red-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2"
                          >
                            Remove
                          </button>
                        </div>
                      ))
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
                            onClick={() => handleAssign(pc.id)}
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
                        onClick={() => openAdd(pc.id)}
                        className="text-sm text-sky-500 hover:text-sky-700 font-medium pt-3 mt-1 border-t border-navy-100 w-full text-left flex items-center gap-1"
                      >
                        + Assign student
                      </button>
                    )}

                    <PcAssignmentReport studentIds={assigned.map((s) => s.id)} expanded={isExpanded} />
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
