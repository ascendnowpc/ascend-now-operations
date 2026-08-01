import { useState, useEffect, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../layout/PageHeader";
import { DataTable, type ColumnDef } from "../ui/DataTable";
import { Button } from "../ui/Button";
import { TextInput, SelectInput } from "../ui/Input";
import { Card } from "../ui/Card";
import { IconPlus, IconDownload } from "../ui/icons";
import type { SessionLog, ProgramType, Teacher, Student } from "../../types/database";
import { useSessionLogs, type SessionLogFilters } from "../../hooks/useSessionLogs";
import { useMonthlyReports, isDateInLockedMonth } from "../../hooks/useMonthlyReports";
import { useTeachers } from "../../hooks/useTeachers";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups, groupSubjectsByBase } from "../../hooks/useCurriculumGroups";
import { useStudents } from "../../hooks/useStudents";
import { useProgramTypes } from "../../hooks/useProgramTypes";
import { teacherFilterOptions } from "../../utils/teacherOptions";
import {
  NO_SHOW_LABELS,
  NO_SHOW_OPTIONS,
  MONTHS,
  ENGAGEMENT_COLORS,
  currentYearOptions,
  getSessionSubjectLabel,
  getProgramTypeLabel,
} from "../../utils/sessionLogDisplay";

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Admin's export is the full audit trail (every teacher, every program
// type); a teacher exporting their own sessions omits the "Teacher" column
// (it would just repeat their own name on every row) and "Program Type"
// (never included in this export historically) — preserved exactly as
// each role's export already behaved before this component existed.
function exportCsvForAdmin(
  logs: SessionLog[],
  teacherLookup: Map<string, string>,
  subjectLookup: Map<number, string>,
  curriculumLookup: Map<number, string>,
  studentLookup: Map<string, Student>,
  programTypes: ProgramType[]
) {
  const headers = ["Date", "Student", "No Show", "Teacher", "Performance Coach", "Program Type", "Subject", "Topic", "Duration (hrs)", "Fathom Link", "Engagement", "Flagged", "Flag Category", "Flag Comments", "Feedback"];
  const rows = logs.map((l) => {
    const student = l.student_id ? studentLookup.get(l.student_id) : undefined;
    const studentDisplay = student
      ? `${student.id} — ${student.first_name} ${student.last_name}`
      : `${l.student_first_name ?? ""} ${l.student_last_name ?? ""}`.trim();
    return [
      new Date(l.session_date).toLocaleDateString(),
      studentDisplay,
      l.no_show_type ? (NO_SHOW_LABELS[l.no_show_type] ?? l.no_show_type) : "",
      l.teacher_id ? (teacherLookup.get(l.teacher_id) ?? "") : "",
      l.coordinator_teacher_id ? (teacherLookup.get(l.coordinator_teacher_id) ?? "") : "",
      getProgramTypeLabel(l.program_type_id, programTypes),
      getSessionSubjectLabel(l.subject_id, l.curriculum_id, subjectLookup, curriculumLookup),
      l.topic ?? "",
      l.session_duration_hrs != null ? String(l.session_duration_hrs) : "",
      l.video_link ?? "",
      l.engagement_rating ?? "",
      l.flag_for_coach ? "Yes" : "No",
      l.flag_category ?? "",
      l.flag_comments ?? "",
      l.performance_feedback ?? "",
    ];
  });
  downloadCsv([headers, ...rows], "session-logs.csv");
}

function exportCsvForTeacher(
  logs: SessionLog[],
  teacherLookup: Map<string, Teacher>,
  subjectLookup: Map<number, string>,
  studentLookup: Map<string, Student>
) {
  const headers = ["Date", "Student", "No Show", "Subject", "Topic", "Performance Coach", "Fathom Link", "Duration (hrs)", "Engagement", "Flagged", "Feedback"];
  const rows = logs.map((l) => {
    const coord = l.coordinator_teacher_id ? teacherLookup.get(l.coordinator_teacher_id) : undefined;
    const coordName = coord ? `${coord.first_name} ${coord.last_name ?? ""}`.trim() : "";
    const student = l.student_id ? studentLookup.get(l.student_id) : undefined;
    const studentDisplay = student
      ? `${student.id} — ${student.first_name} ${student.last_name}`
      : `${l.student_first_name ?? ""} ${l.student_last_name ?? ""}`.trim();
    return [
      new Date(l.session_date).toLocaleDateString(),
      studentDisplay,
      l.no_show_type ? (NO_SHOW_LABELS[l.no_show_type] ?? l.no_show_type) : "",
      l.subject_id ? (subjectLookup.get(l.subject_id) ?? "") : "",
      l.topic ?? "",
      coordName,
      l.video_link ?? "",
      l.session_duration_hrs != null ? String(l.session_duration_hrs) : "",
      l.engagement_rating ?? "",
      l.flag_for_coach ? "Yes" : "No",
      l.performance_feedback ?? "",
    ];
  });
  downloadCsv([headers, ...rows], "my-sessions.csv");
}

/**
 * Shared session-log LIST view used by BOTH the admin ("Session Logs",
 * `/admin/session-logs`) and teacher/coach ("Session Logging",
 * `/teacher/sessions`) pages — one component so the filter grid and all 15
 * table columns can't drift apart again (they were ~90% byte-identical
 * copy-paste before this). The two roles differ ONLY in:
 *   - `scopeToTeacherId` — undefined for admin (sees every session; RLS
 *     itself scopes this via `is_admin()`), the logged-in teacher's own id
 *     otherwise (also passed straight to `useSessionLogs` for the DB-level
 *     `.eq("teacher_id", ...)` filter — this was already how the teacher
 *     page scoped itself, not something new);
 *   - a "Teacher" filter dropdown and table column — admin-only;
 *   - the CSV export shape (`exportCsvForAdmin` vs `exportCsvForTeacher`,
 *     preserved exactly as each already behaved — see their comments);
 *   - header copy, the "add session" route/label, empty-state message, and
 *     an optional error banner + extra loading flag (teacher's own-profile
 *     load state) via `children`-free small props, not a big role switch.
 */
export function SessionLogsListView({
  role,
  title,
  description,
  addSessionPath,
  addButtonLabel,
  addDisabled,
  detailPath,
  emptyMessage,
  scopeToTeacherId,
  scopeToStudentIds,
  studentFilterOptions,
  showTeacherColumn,
  hideCoordinatorFilter,
  extraLoading,
  errorBanner,
}: {
  role: "admin" | "teacher";
  title: string;
  description: string;
  addSessionPath: string;
  addButtonLabel: string;
  addDisabled?: boolean;
  detailPath: (id: number) => string;
  emptyMessage: string;
  scopeToTeacherId?: string;
  // Restricts to a whole set of students at once (e.g. a Performance
  // Coach's assigned students), across every teacher who's logged a
  // session for them — unlike scopeToTeacherId, which scopes to one
  // teacher's own sessions.
  scopeToStudentIds?: string[];
  // When provided, renders a single "Student" dropdown restricted to these
  // options instead of the free-text Student ID/first/last name filters —
  // used alongside scopeToStudentIds so a PC picks from just their own
  // assigned students rather than searching every student in the system.
  studentFilterOptions?: { value: string; label: string }[];
  // Independent of `role` — shows the Teacher column/filter for a
  // teacher-role view that (unlike a plain teacher's own session list) can
  // contain sessions logged by more than one teacher, e.g. a PC's
  // students-wide view.
  showTeacherColumn?: boolean;
  // Hides the "Coordinator/PC" filter — for a Performance Coach viewing
  // their own scoped tabs (their own sessions, or their assigned students'),
  // the coordinator is always themselves, so the filter is a redundant
  // no-op there. Admin (every coordinator can appear) and a plain teacher
  // (whose logged sessions can span students assigned to different PCs)
  // both keep it.
  hideCoordinatorFilter?: boolean;
  extraLoading?: boolean;
  errorBanner?: ReactNode;
}) {
  const isAdmin = role === "admin";
  const showTeacher = isAdmin || Boolean(showTeacherColumn);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Deep-link filters: a student-detail "Learner's actual hours" row links
  // here with ?student=&subject=&curriculum= (or ?student=&teacher=) so the
  // list opens already scoped to that subject/teacher for that student.
  const initialStudentParam = searchParams.get("student") ?? "";
  const [filters, setFilters] = useState<SessionLogFilters>(() => {
    const init: SessionLogFilters = {};
    const subject = searchParams.get("subject");
    const curriculum = searchParams.get("curriculum");
    const teacher = searchParams.get("teacher");
    if (initialStudentParam) init.studentIdExact = initialStudentParam;
    if (subject) init.subjectId = Number(subject);
    if (curriculum) init.curriculumId = Number(curriculum);
    if (teacher && !scopeToTeacherId) init.teacherId = teacher;
    return init;
  });
  // Prefill the visible "Student ID" box (admin/plain-teacher variant) so the
  // active student filter is shown, not just silently applied.
  const [studentIdInput, setStudentIdInput] = useState(
    studentFilterOptions ? "" : initialStudentParam
  );
  const [firstNameInput, setFirstNameInput] = useState("");
  const [lastNameInput, setLastNameInput] = useState("");
  const [subjectBroadCat, setSubjectBroadCat] = useState<"" | "academic" | "beyond_academic" | "college_counselling">("");
  const [filterCurriculumId, setFilterCurriculumId] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterBaseKey, setFilterBaseKey] = useState("");
  const [filterLevelSubjectId, setFilterLevelSubjectId] = useState("");
  const [filterProgramSelection, setFilterProgramSelection] = useState("");

  const { logs, loading: logsLoading } = useSessionLogs(filters, scopeToTeacherId, undefined, scopeToStudentIds);
  const { teachers } = useTeachers();
  const { subjects } = useSubjects();
  const { curricula } = useCurricula();
  const { groups: allGroups } = useAllCurriculumGroups();
  const { students } = useStudents();
  const { programTypes } = useProgramTypes();
  const { fetchLockedMonths } = useMonthlyReports();
  const [lockedMonths, setLockedMonths] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchLockedMonths().then(({ data }) => setLockedMonths(data));
  }, [fetchLockedMonths]);

  const teacherNameLookup = new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()]));
  const teacherLookup = new Map(teachers.map((t) => [t.id, t]));
  const subjectLookup = new Map(subjects.map((s) => [s.id, s.name]));
  const curriculumLookup = new Map(curricula.map((c) => [c.id, c.name]));
  const studentLookup = new Map(students.map((s) => [s.id, s]));

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((prev) => ({ ...prev, studentId: studentIdInput.trim() || undefined }));
    }, 350);
    return () => clearTimeout(t);
  }, [studentIdInput]);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((prev) => ({ ...prev, studentFirstName: firstNameInput.trim() || undefined }));
    }, 350);
    return () => clearTimeout(t);
  }, [firstNameInput]);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((prev) => ({ ...prev, studentLastName: lastNameInput.trim() || undefined }));
    }, 350);
    return () => clearTimeout(t);
  }, [lastNameInput]);

  // Active staff only — see teacherFilterOptions for why, and for what it
  // deliberately costs (a retired teacher's logs stay listed, just not
  // filterable by name).
  const teacherFilterChoices = teacherFilterOptions(teachers);
  const coachFilterChoices = teacherFilterOptions(teachers, { performanceCoachesOnly: true });
  const parentProgramTypes = programTypes.filter((p) => p.parent_id === null && p.is_active);

  const isRealProgramType = filterProgramSelection !== "" &&
    filterProgramSelection !== "__academic__" &&
    filterProgramSelection !== "__beyond_academic__";

  const subProgramTypes = isRealProgramType
    ? programTypes.filter((p) => p.parent_id === Number(filterProgramSelection) && p.is_active)
    : [];

  // Academic subject picking follows the real Curriculum → Group → Subject →
  // Level hierarchy (db/docs/SUBJECT_HIERARCHY.md §2), the same cascade the
  // session-log form uses: SL/HL are separate rows sharing one name, grouped by
  // base name into a single Subject choice plus a Level step.
  const academicGroups = allGroups.filter((g) => g.is_active && String(g.curriculum_id) === filterCurriculumId);
  const academicHasGroups = academicGroups.length > 0;
  const academicBaseSubjects =
    subjectBroadCat === "academic" && filterCurriculumId
      ? academicHasGroups
        ? filterGroupId
          ? subjects.filter((s) => s.is_active && String(s.curriculum_group_id) === filterGroupId)
          : []
        : subjects.filter((s) => s.is_active && String(s.curriculum_id) === filterCurriculumId)
      : [];
  const academicBaseGroups = groupSubjectsByBase(academicBaseSubjects);
  const activeBaseGroup = academicBaseGroups.find((g) => g.key === filterBaseKey) ?? null;
  const academicNeedsLevel = !!activeBaseGroup && activeBaseGroup.items.length > 1;

  // Beyond Academic / College Counselling are each ONE flat Subject dropdown —
  // no "Section"/grouping step (§3/§3b). Beyond Academic is the loose catch-all
  // "not academic and not college counselling"; College Counselling is its own
  // category. Both sorted alphabetically.
  const flatSubjectsSorted = (predicate: (category: string | null) => boolean) =>
    subjects.filter((s) => s.is_active && predicate(s.category)).sort((a, b) => a.name.localeCompare(b.name));
  const beyondSubjects =
    subjectBroadCat === "beyond_academic"
      ? flatSubjectsSorted((c) => c !== "academic" && c !== "college_counselling")
      : [];
  const collegeSubjects =
    subjectBroadCat === "college_counselling" ? flatSubjectsSorted((c) => c === "college_counselling") : [];

  // Academic subject match — level-agnostic (both SL & HL) until a level is
  // picked; applied to the rows client-side.
  const academicSubjectIds: Set<number> | null = filterLevelSubjectId
    ? new Set([Number(filterLevelSubjectId)])
    : activeBaseGroup
    ? new Set(activeBaseGroup.items.map((s) => s.id))
    : null;
  const visibleLogs = academicSubjectIds
    ? logs.filter((l) => l.subject_id != null && academicSubjectIds.has(l.subject_id))
    : logs;

  function resetSubjectCascade() {
    setFilterCurriculumId("");
    setFilterGroupId("");
    setFilterBaseKey("");
    setFilterLevelSubjectId("");
  }

  function handleProgramTypeChange(val: string) {
    setFilterProgramSelection(val);
    resetSubjectCascade();
    setFilters((prev) => ({ ...prev, subjectId: undefined, curriculumId: undefined }));
    if (!val) {
      setSubjectBroadCat("");
      setFilters((prev) => ({ ...prev, programTypeIds: undefined }));
      return;
    }
    const pid = Number(val);
    const selectedPt = programTypes.find((p) => p.id === pid);
    const childIds = programTypes.filter((p) => p.parent_id === pid && p.is_active).map((p) => p.id);
    setFilters((prev) => ({ ...prev, programTypeIds: [pid, ...childIds].join(',') }));
    if (selectedPt?.type === "academic") {
      setSubjectBroadCat("academic");
    } else if (selectedPt?.type === "beyond_academic") {
      setSubjectBroadCat("beyond_academic");
    } else if (selectedPt?.type === "college_counselling") {
      setSubjectBroadCat("college_counselling");
    } else {
      setSubjectBroadCat("");
    }
  }

  function handleSubProgramChange(val: string) {
    if (val) {
      setFilters((prev) => ({ ...prev, programTypeIds: val }));
    } else {
      const pid = Number(filterProgramSelection);
      const childIds = programTypes.filter((p) => p.parent_id === pid && p.is_active).map((p) => p.id);
      setFilters((prev) => ({ ...prev, programTypeIds: [pid, ...childIds].join(',') }));
    }
  }

  function clearAll() {
    setFilters({});
    setStudentIdInput("");
    setFirstNameInput("");
    setLastNameInput("");
    setSubjectBroadCat("");
    setFilterProgramSelection("");
    resetSubjectCascade();
  }

  function getStudentDisplay(l: SessionLog): string {
    const s = l.student_id ? studentLookup.get(l.student_id) : undefined;
    if (s) return `${s.id} — ${s.first_name} ${s.last_name}`;
    return `${l.student_first_name ?? ""} ${l.student_last_name ?? ""}`.trim() || "—";
  }

  function handleExportCsv() {
    if (isAdmin) {
      exportCsvForAdmin(visibleLogs, teacherNameLookup, subjectLookup, curriculumLookup, studentLookup, programTypes);
    } else {
      exportCsvForTeacher(visibleLogs, teacherLookup, subjectLookup, studentLookup);
    }
  }

  const columns: ColumnDef<SessionLog>[] = [
    {
      header: "Date",
      accessor: (l) => (
        <span className="whitespace-nowrap font-medium text-navy-700 inline-flex items-center gap-1.5">
          {new Date(l.session_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          {isDateInLockedMonth(l.session_date, lockedMonths) && (
            <span title="This month's report is locked — read only">🔒</span>
          )}
        </span>
      ),
    },
    { header: "Student", accessor: (l) => <span className="font-medium">{getStudentDisplay(l)}</span> },
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
    // Admin (or a PC's students-wide view) sees a "Teacher" column, since
    // those can span many teachers; a teacher viewing their own list omits
    // it — it would just repeat their own name.
    ...(showTeacher ? [{
      header: "Teacher",
      accessor: (l: SessionLog) => l.teacher_id ? (teacherNameLookup.get(l.teacher_id) ?? "—") : <span className="text-navy-300">—</span>,
    }] : []),
    {
      header: "Performance Coach",
      accessor: (l) =>
        l.coordinator_teacher_id ? (teacherNameLookup.get(l.coordinator_teacher_id) ?? "—") : <span className="text-navy-300">—</span>,
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
    {
      header: "Subject",
      accessor: (l) => getSessionSubjectLabel(l.subject_id, l.curriculum_id, subjectLookup, curriculumLookup),
    },
    { header: "Topic", accessor: (l) => l.topic ?? <span className="text-navy-300">—</span> },
    {
      header: "Duration",
      accessor: (l) =>
        l.session_duration_hrs != null ? (
          <span className="whitespace-nowrap">{l.session_duration_hrs} hr{l.session_duration_hrs !== 1 ? "s" : ""}</span>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
    {
      header: "Engagement",
      accessor: (l) =>
        l.engagement_rating ? (
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${ENGAGEMENT_COLORS[l.engagement_rating] ?? ""}`}>
            {l.engagement_rating}
          </span>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
    {
      header: "Independent Work",
      accessor: (l) =>
        l.independent_work && l.independent_work.length > 0 ? (
          <span className="text-xs text-navy-600 capitalize">{l.independent_work[0].replace(/_/g, " ")}</span>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
    {
      header: "Feedback",
      accessor: (l) =>
        l.performance_feedback ? (
          <span className="text-xs text-navy-600 line-clamp-2 max-w-[180px] block">{l.performance_feedback}</span>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
    {
      header: "Flag",
      accessor: (l) =>
        l.flag_for_coach ? (
          <span className="inline-block rounded-full bg-red-100 text-red-700 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">
            {l.flag_category ?? "Flagged"}
          </span>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
    {
      header: "Flag Comments",
      accessor: (l) =>
        l.flag_comments ? (
          <span className="text-xs text-navy-600 line-clamp-2 max-w-[180px] block">{l.flag_comments}</span>
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
            onClick={(e) => e.stopPropagation()}
          >
            View ↗
          </a>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
    {
      header: "Transcript",
      accessor: (l) =>
        l.fathom_summary_doc_url ? (
          <a
            href={l.fathom_summary_doc_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-500 underline text-xs font-medium whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            Download ↗
          </a>
        ) : l.fathom_summary ? (
          <span className="text-xs text-navy-500 line-clamp-1 max-w-[160px]">{l.fathom_summary}</span>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleExportCsv}
              className="flex items-center gap-2"
              disabled={visibleLogs.length === 0}
            >
              <IconDownload /> Export CSV
            </Button>
            <Button
              onClick={() => navigate(addSessionPath)}
              className="flex items-center gap-2"
              disabled={addDisabled}
            >
              <IconPlus /> {addButtonLabel}
            </Button>
          </div>
        }
      />

      {errorBanner}

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
          <SelectInput label="Year" placeholder="All years" value={filters.year ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, year: e.target.value || undefined, month: undefined }))}
            options={currentYearOptions()} />
          <SelectInput label="Month" placeholder="All months" value={filters.month ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, month: e.target.value || undefined }))}
            options={MONTHS} disabled={!filters.year} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-navy-700">From date</label>
            <input type="date" value={filters.dateFrom ?? ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value || undefined }))}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-navy-700">To date</label>
            <input type="date" value={filters.dateTo ?? ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value || undefined }))}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300" />
          </div>
          {showTeacher && (
            <SelectInput label="Teacher" placeholder="All teachers" value={filters.teacherId ? String(filters.teacherId) : ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, teacherId: e.target.value || undefined }))}
              options={teacherFilterChoices} />
          )}
          {!hideCoordinatorFilter && (
            <SelectInput label="Performance Coach" placeholder="All performance coaches" value={filters.coordinatorId ? String(filters.coordinatorId) : ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, coordinatorId: e.target.value || undefined }))}
              options={coachFilterChoices} />
          )}
          <SelectInput label="No Show" placeholder="All sessions" value={filters.noShowType ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, noShowType: e.target.value ? (e.target.value as SessionLogFilters['noShowType']) : undefined }))}
            options={NO_SHOW_OPTIONS} />
          <SelectInput label="Engagement" placeholder="All levels" value={filters.engagementRating ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, engagementRating: e.target.value ? (e.target.value as 'low' | 'medium' | 'high') : undefined }))}
            options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />
          <SelectInput label="Flag" placeholder="All" value={filters.flagged ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, flagged: e.target.value ? (e.target.value as 'yes' | 'no') : undefined }))}
            options={[{ value: "yes", label: "Flagged" }, { value: "no", label: "Not flagged" }]} />
          <SelectInput label="Type of program" placeholder="All types" value={filterProgramSelection}
            onChange={(e) => handleProgramTypeChange(e.target.value)}
            options={parentProgramTypes.map((p) => ({ value: String(p.id), label: p.name }))} />
          {subProgramTypes.length > 0 && (
            <SelectInput label="Sub-program" placeholder="All sub-programs"
              value={filters.programTypeIds && !filters.programTypeIds.includes(',') ? filters.programTypeIds : ""}
              onChange={(e) => handleSubProgramChange(e.target.value)}
              options={subProgramTypes.map((p) => ({ value: String(p.id), label: p.name }))} />
          )}
          {subjectBroadCat === "academic" && (
            <SelectInput label="Curriculum" placeholder="All curricula" value={filterCurriculumId}
              onChange={(e) => {
                const val = e.target.value;
                setFilterCurriculumId(val);
                setFilterGroupId("");
                setFilterBaseKey("");
                setFilterLevelSubjectId("");
                setFilters((prev) => ({ ...prev, curriculumId: val ? Number(val) : undefined, subjectId: undefined }));
              }}
              options={curricula.filter((c) => c.is_active).map((c) => ({ value: String(c.id), label: c.name }))} />
          )}
          {subjectBroadCat === "academic" && filterCurriculumId && academicHasGroups && (
            <SelectInput label="Subject group" placeholder="All groups" value={filterGroupId}
              onChange={(e) => {
                setFilterGroupId(e.target.value);
                setFilterBaseKey("");
                setFilterLevelSubjectId("");
              }}
              options={academicGroups.map((g) => ({ value: String(g.id), label: g.name }))} />
          )}
          {subjectBroadCat === "academic" && academicBaseGroups.length > 0 && (
            <SelectInput label="Subject" placeholder="All subjects" value={filterBaseKey}
              onChange={(e) => {
                setFilterBaseKey(e.target.value);
                setFilterLevelSubjectId("");
              }}
              options={academicBaseGroups.map((g) => ({ value: g.key, label: g.baseLabel }))} />
          )}
          {subjectBroadCat === "academic" && academicNeedsLevel && activeBaseGroup && (
            <SelectInput label="Level" placeholder="All levels" value={filterLevelSubjectId}
              onChange={(e) => setFilterLevelSubjectId(e.target.value)}
              options={activeBaseGroup.items.map((s) => ({ value: String(s.id), label: s.level || "—" }))} />
          )}
          {subjectBroadCat === "beyond_academic" && beyondSubjects.length > 0 && (
            <SelectInput label="Subject" placeholder="All subjects" value={filters.subjectId ? String(filters.subjectId) : ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, subjectId: e.target.value ? Number(e.target.value) : undefined }))}
              options={beyondSubjects.map((s) => ({ value: String(s.id), label: s.name }))} />
          )}
          {subjectBroadCat === "college_counselling" && collegeSubjects.length > 0 && (
            <SelectInput label="Subject" placeholder="All subjects" value={filters.subjectId ? String(filters.subjectId) : ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, subjectId: e.target.value ? Number(e.target.value) : undefined }))}
              options={collegeSubjects.map((s) => ({ value: String(s.id), label: s.name }))} />
          )}
          {studentFilterOptions ? (
            <SelectInput label="Student" placeholder="All my students"
              value={filters.studentIdExact ?? ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, studentIdExact: e.target.value || undefined }))}
              options={studentFilterOptions} />
          ) : (
            <>
              <TextInput label="Student ID" placeholder="e.g. S1"
                value={studentIdInput} onChange={(e) => setStudentIdInput(e.target.value)} />
              <TextInput label="First name" placeholder="First name…"
                value={firstNameInput} onChange={(e) => setFirstNameInput(e.target.value)} />
              <TextInput label="Last name" placeholder="Last name…"
                value={lastNameInput} onChange={(e) => setLastNameInput(e.target.value)} />
            </>
          )}
        </div>
        <div className="flex justify-end mt-3">
          <Button size="sm" variant="ghost" onClick={clearAll}>Clear all</Button>
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={visibleLogs}
        getRowId={(l) => l.id}
        loading={logsLoading || Boolean(extraLoading)}
        onRowClick={(l) => navigate(detailPath(l.id))}
        emptyMessage={emptyMessage}
      />
    </>
  );
}
