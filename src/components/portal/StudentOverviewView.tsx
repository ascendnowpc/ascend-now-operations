import { useEffect, useMemo, useState } from "react";
import { Card } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import { DataTable, type ColumnDef } from "../ui/DataTable";
import { IconBook, IconTag, IconBarChart, IconArrowLeft } from "../ui/icons";
import { useSessionLogs } from "../../hooks/useSessionLogs";
import { useStudentPackages } from "../../hooks/useStudentPackages";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useTeachers } from "../../hooks/useTeachers";
import { useProgramTypes } from "../../hooks/useProgramTypes";
import { useSubjectNotes } from "../../hooks/useSubjectNotes";
import type { SessionLog, StudentPackage, PackageTopup, Student, ProgramType, SubjectNote } from "../../types/database";
import { subjectLabel } from "../../utils/subjectLabel";
import { NO_SHOW_LABELS, getProgramTypeLabel } from "../../utils/sessionLogDisplay";
import { SubjectNotesList } from "../notes/SubjectNotesList";

// The three top-level branches every subject lives under — see
// db/docs/SUBJECT_HIERARCHY.md §1. Which branch a subject belongs to is read
// off its `category`: 'academic' and 'college_counselling' are exact, and
// everything else ('beyond_academic', 'passion_projects', 'profile_building',
// …) is the loose Beyond Academic catch-all.
type BranchKey = "academic" | "beyond_academic" | "college_counselling";

function branchOfCategory(category: string | null): BranchKey {
  if (category === "academic") return "academic";
  if (category === "college_counselling") return "college_counselling";
  return "beyond_academic";
}

// A student's package course_type_id maps 1:1 to a branch (verified live:
// Academic = 1, Beyond Academic = 2, College Counselling = 3). Bundle pools
// (Foundation Program / All-In-One) carry the real billing course_type_id on
// each pool row, so this correctly surfaces e.g. All-In-One → Beyond + College
// and Foundation Program → Beyond, exactly as the packages themselves define.
function branchOfCourseType(courseTypeId: number | null): BranchKey | null {
  if (courseTypeId === 1) return "academic";
  if (courseTypeId === 2) return "beyond_academic";
  if (courseTypeId === 3) return "college_counselling";
  return null;
}

interface BranchMeta {
  key: BranchKey;
  title: string;
  icon: React.ReactNode;
  // Tailwind classes for the branch's accent (hover + icon chip), sampled to
  // roughly match each course type's own colour on the packages page.
  cardAccent: string;
  iconAccent: string;
}

const BRANCHES: BranchMeta[] = [
  {
    key: "academic",
    title: "Academic",
    icon: <IconBook />,
    cardAccent: "hover:border-green-300 hover:bg-green-50/40",
    iconAccent: "bg-green-100 text-green-700",
  },
  {
    key: "beyond_academic",
    title: "Beyond Academic",
    icon: <IconTag />,
    cardAccent: "hover:border-orange-300 hover:bg-orange-50/40",
    iconAccent: "bg-orange-100 text-orange-700",
  },
  {
    key: "college_counselling",
    title: "College Counselling",
    icon: <IconBarChart />,
    cardAccent: "hover:border-sky-300 hover:bg-sky-50/40",
    iconAccent: "bg-sky-100 text-sky-700",
  },
];

// One distinct subject inside a branch — keyed by subject + curriculum, since
// the same subject picked under two curricula (or an ungrouped one) is two
// distinct buttons, matching how the packages page keys its breakdowns.
interface SubjectNode {
  key: string;
  subjectId: number;
  curriculumId: number | null;
  label: string;
  branch: BranchKey;
  sessions: SessionLog[];
}

type PackageWithTopups = StudentPackage & { package_topups: PackageTopup[] };

// The student dashboard "Overview" — an intuitive drill-down: the branches the
// student has (Academic / Beyond Academic / College Counselling, decided by
// their packages and the sessions logged for them), each opening to the
// subjects taught in that branch (built automatically from session logs — a
// subject appears the moment a teacher logs a session against it), each of
// which opens to that subject's own session history, grouped by teacher.
// Read-only, scoped to the logged-in student's own record via RLS.
export function StudentOverviewView({ student }: { student: Student }) {
  const { logs, loading: logsLoading } = useSessionLogs({}, undefined, student.id);
  const { fetchPackagesForStudent } = useStudentPackages();
  const { subjects } = useSubjects();
  const { curricula } = useCurricula();
  const { teachers } = useTeachers();
  const { programTypes } = useProgramTypes();
  const { notes } = useSubjectNotes(student.id);

  const [packages, setPackages] = useState<PackageWithTopups[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);

  // Drill-down state: null branch → the three branch boxes; a branch selected →
  // its subject buttons; a subject selected → that subject's sessions.
  const [selectedBranch, setSelectedBranch] = useState<BranchKey | null>(null);
  const [selectedSubjectKey, setSelectedSubjectKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPackagesLoading(true);
      const pkgs = await fetchPackagesForStudent(student.id);
      if (cancelled) return;
      setPackages(pkgs);
      setPackagesLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [student.id, fetchPackagesForStudent]);

  const subjectLookup = useMemo(
    () => new Map(subjects.map((s) => [s.id, s])),
    [subjects],
  );
  const curriculumLookup = useMemo(
    () => new Map(curricula.map((c) => [c.id, c.name])),
    [curricula],
  );
  const teacherLookup = useMemo(
    () => new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()])),
    [teachers],
  );

  // Build the subject nodes per branch from the student's session logs. A
  // subject button exists purely because a session was logged against it — no
  // separate catalogue of "your subjects" is needed.
  const subjectNodesByBranch = useMemo(() => {
    const nodes = new Map<string, SubjectNode>();
    for (const log of logs) {
      if (log.subject_id == null) continue;
      const subject = subjectLookup.get(log.subject_id);
      if (!subject) continue;
      const branch = branchOfCategory(subject.category);
      const key = `${log.subject_id}:${log.curriculum_id ?? ""}`;
      let node = nodes.get(key);
      if (!node) {
        node = {
          key,
          subjectId: log.subject_id,
          curriculumId: log.curriculum_id,
          label: subjectLabel(subject.name, subject.level),
          branch,
          sessions: [],
        };
        nodes.set(key, node);
      }
      node.sessions.push(log);
    }
    const byBranch = new Map<BranchKey, SubjectNode[]>();
    for (const node of nodes.values()) {
      const arr = byBranch.get(node.branch) ?? [];
      arr.push(node);
      byBranch.set(node.branch, arr);
    }
    // Sort each branch's subjects by session count (busiest first), then name.
    for (const arr of byBranch.values()) {
      arr.sort((a, b) => b.sessions.length - a.sessions.length || a.label.localeCompare(b.label));
    }
    return byBranch;
  }, [logs, subjectLookup]);

  // Which branches to actually show: any the student holds a package in, plus
  // any that already have sessions logged (so a session in a branch is never
  // hidden just because the package mapping didn't cover it). Kept in the fixed
  // Academic → Beyond → College order.
  const visibleBranches = useMemo(() => {
    const present = new Set<BranchKey>();
    for (const pkg of packages) {
      const b = branchOfCourseType(pkg.course_type_id);
      if (b) present.add(b);
    }
    for (const b of subjectNodesByBranch.keys()) present.add(b);
    return BRANCHES.filter((b) => present.has(b.key));
  }, [packages, subjectNodesByBranch]);

  const loading = logsLoading || packagesLoading;

  if (loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-navy-300 text-sm">
          <Spinner /> Loading…
        </div>
      </Card>
    );
  }

  // ---- Level 2: a subject's session history, grouped by teacher ----
  if (selectedBranch && selectedSubjectKey) {
    const node = (subjectNodesByBranch.get(selectedBranch) ?? []).find((n) => n.key === selectedSubjectKey);
    const subjectNotes = node
      ? notes.filter((n) => n.subject_id === node.subjectId && (n.curriculum_id ?? null) === node.curriculumId)
      : [];
    const branchMeta = BRANCHES.find((b) => b.key === selectedBranch)!;
    return (
      <>
        <BackButton label={`Back to ${branchMeta.title}`} onClick={() => setSelectedSubjectKey(null)} />
        <SubjectSessions
          node={node ?? null}
          teacherLookup={teacherLookup}
          programTypes={programTypes}
          notes={subjectNotes}
        />
      </>
    );
  }

  // ---- Level 1: a branch's subjects ----
  if (selectedBranch) {
    const branchMeta = BRANCHES.find((b) => b.key === selectedBranch)!;
    const nodes = subjectNodesByBranch.get(selectedBranch) ?? [];
    return (
      <>
        <BackButton label="Back to Overview" onClick={() => setSelectedBranch(null)} />
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${branchMeta.iconAccent}`}>
              {branchMeta.icon}
            </span>
            <p className="font-semibold text-navy-700 text-lg">{branchMeta.title}</p>
          </div>
          {nodes.length === 0 ? (
            <p className="text-sm text-navy-400">
              No subjects yet — a subject will appear here once a teacher logs a session for it.
            </p>
          ) : selectedBranch === "academic" ? (
            <AcademicSubjectGroups
              nodes={nodes}
              curriculumLookup={curriculumLookup}
              onOpen={(key) => setSelectedSubjectKey(key)}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {nodes.map((n) => (
                <SubjectButton key={n.key} node={n} onOpen={() => setSelectedSubjectKey(n.key)} />
              ))}
            </div>
          )}
        </Card>
      </>
    );
  }

  // ---- Level 0: the branch boxes ----
  if (visibleBranches.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-sm text-navy-400">
          Nothing to show yet — your subjects appear here once your teachers start logging sessions.
        </p>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {visibleBranches.map((branch) => {
        const nodes = subjectNodesByBranch.get(branch.key) ?? [];
        const sessionCount = nodes.reduce((sum, n) => sum + n.sessions.length, 0);
        return (
          <button
            key={branch.key}
            onClick={() => setSelectedBranch(branch.key)}
            className={`text-left bg-white rounded-2xl border border-navy-100 shadow-sm p-5 transition-colors ${branch.cardAccent} focus:outline-none focus:ring-2 focus:ring-sky-300`}
          >
            <span className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${branch.iconAccent}`}>
              {branch.icon}
            </span>
            <p className="font-semibold text-navy-700 text-lg mb-2">{branch.title}</p>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-navy-600">
                <span className="font-bold tabular-nums">{nodes.length}</span>{" "}
                <span className="text-navy-400">{nodes.length === 1 ? "subject" : "subjects"}</span>
              </span>
              <span className="text-navy-600">
                <span className="font-bold tabular-nums">{sessionCount}</span>{" "}
                <span className="text-navy-400">{sessionCount === 1 ? "session" : "sessions"}</span>
              </span>
            </div>
          </button>
        );
      })}
      </div>
    </>
  );
}

// ---- Building blocks ----

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-500 hover:text-sky-600 mb-4"
    >
      <IconArrowLeft />
      {label}
    </button>
  );
}

function SubjectButton({ node, onOpen }: { node: SubjectNode; onOpen: () => void }) {
  const count = node.sessions.length;
  return (
    <button
      onClick={onOpen}
      className="text-left border border-navy-100 rounded-xl p-4 hover:border-sky-300 hover:bg-sky-50/40 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300"
    >
      <p className="font-semibold text-navy-700">{node.label}</p>
      <p className="text-xs text-navy-400 mt-1">
        {count} {count === 1 ? "session" : "sessions"}
      </p>
    </button>
  );
}

// Academic subjects keep their curriculum context ("the full hierarchy") — the
// buttons are grouped under a heading per curriculum, matching the Curriculum →
// Subject shape the rest of the app uses.
function AcademicSubjectGroups({
  nodes,
  curriculumLookup,
  onOpen,
}: {
  nodes: SubjectNode[];
  curriculumLookup: Map<number, string>;
  onOpen: (key: string) => void;
}) {
  const groups = new Map<string, { label: string; nodes: SubjectNode[] }>();
  for (const node of nodes) {
    const gkey = node.curriculumId != null ? String(node.curriculumId) : "__other__";
    const label = node.curriculumId != null ? curriculumLookup.get(node.curriculumId) ?? "Other" : "Other";
    const g = groups.get(gkey) ?? { label, nodes: [] };
    g.nodes.push(node);
    groups.set(gkey, g);
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="space-y-5">
      {sortedGroups.map((g) => (
        <div key={g.label}>
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-400 mb-2">{g.label}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.nodes.map((n) => (
              <SubjectButton key={n.key} node={n} onOpen={() => onOpen(n.key)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SubjectSessions({
  node,
  teacherLookup,
  programTypes,
  notes,
}: {
  node: SubjectNode | null;
  teacherLookup: Map<number, string>;
  programTypes: ProgramType[];
  notes: SubjectNote[];
}) {
  if (!node) {
    return (
      <Card className="p-5">
        <p className="text-sm text-navy-400">Subject not found.</p>
      </Card>
    );
  }

  // Section the sessions by teacher — one table per teacher, most recent first
  // within each, and the teachers ordered by how many sessions they've logged.
  const byTeacher = new Map<number | "none", SessionLog[]>();
  for (const s of node.sessions) {
    const k = s.teacher_id ?? "none";
    const arr = byTeacher.get(k) ?? [];
    arr.push(s);
    byTeacher.set(k, arr);
  }
  const teacherSections = Array.from(byTeacher.entries())
    .map(([teacherId, sessions]) => ({
      teacherId,
      name: teacherId === "none" ? "Unassigned" : teacherLookup.get(teacherId) ?? `Teacher ${teacherId}`,
      sessions: [...sessions].sort(
        (a, b) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime(),
      ),
    }))
    .sort((a, b) => b.sessions.length - a.sessions.length || a.name.localeCompare(b.name));

  const columns: ColumnDef<SessionLog>[] = [
    {
      header: "Date",
      accessor: (l) => (
        <span className="whitespace-nowrap font-medium text-navy-700">
          {new Date(l.session_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
      ),
    },
    {
      header: "No Show",
      accessor: (l) =>
        l.no_show_type ? (
          <span className="inline-block rounded-full bg-amber-100 text-amber-700 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">
            {NO_SHOW_LABELS[l.no_show_type] ?? l.no_show_type}
          </span>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
    {
      header: "Program Type",
      accessor: (l) =>
        l.program_type_id ? (
          <span className="whitespace-nowrap text-sm">{getProgramTypeLabel(l.program_type_id, programTypes)}</span>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
    { header: "Topic", accessor: (l) => l.topic ?? <span className="text-navy-300">—</span> },
    {
      header: "Duration",
      accessor: (l) =>
        l.session_duration_hrs != null ? (
          <span className="whitespace-nowrap">
            {l.session_duration_hrs} hr{l.session_duration_hrs !== 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
    {
      header: "Recording",
      accessor: (l) =>
        l.video_link ? (
          <a
            href={l.video_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-500 underline text-sm whitespace-nowrap font-medium"
          >
            View ↗
          </a>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="font-semibold text-navy-700 text-lg">{node.label}</p>

      {teacherSections.map((section) => (
        <Card key={String(section.teacherId)} className="p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <p className="font-semibold text-navy-700">{section.name}</p>
            <span className="text-xs text-navy-400">
              {section.sessions.length} {section.sessions.length === 1 ? "session" : "sessions"}
            </span>
          </div>
          <div className="px-5 pb-5">
            <DataTable
              columns={columns}
              rows={section.sessions}
              getRowId={(l) => l.id}
              emptyMessage="No sessions logged yet."
            />
          </div>
        </Card>
      ))}

      {notes.length > 0 && (
        <Card className="p-5">
          <p className="font-semibold text-navy-700 mb-3">Notes from your teachers</p>
          <SubjectNotesList notes={notes} teacherLookup={teacherLookup} />
        </Card>
      )}
    </div>
  );
}
