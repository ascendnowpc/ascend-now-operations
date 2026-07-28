import { useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { SelectInput } from "../ui/Input";
import { DataTable, type ColumnDef } from "../ui/DataTable";
import { useSessionLogs, type SessionLogFilters } from "../../hooks/useSessionLogs";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups, groupSubjectsByBase } from "../../hooks/useCurriculumGroups";
import { useTeachers } from "../../hooks/useTeachers";
import { useProgramTypes } from "../../hooks/useProgramTypes";
import type { SessionLog, Student } from "../../types/database";
import {
  NO_SHOW_LABELS,
  NO_SHOW_OPTIONS,
  MONTHS,
  currentYearOptions,
  getSessionSubjectLabel,
  getProgramTypeLabel,
} from "../../utils/sessionLogDisplay";

// Read-only session-log history for a single student — filters and columns
// modeled on the admin/teacher "Session Logs" list, minus anything that
// identifies *which* student (redundant here — the page is already scoped
// to one student), minus admin-only actions (add/edit/CSV export), and, as
// of 2026-07-28, minus the coach-internal fields a student shouldn't see:
// Engagement, Independent Work, Feedback, and Flag + Flag Comments (and the
// Engagement/Flag filters that would otherwise let those same ratings leak
// back in indirectly), and, as of 2026-07-15, minus the Transcript column
// (Fathom summary/doc), which shouldn't be surfaced on the student dashboard.
export function StudentSessionsView({ student }: { student: Student }) {
  const { subjects } = useSubjects();
  const { curricula } = useCurricula();
  const { groups: allGroups } = useAllCurriculumGroups();
  const { teachers } = useTeachers();
  const { programTypes } = useProgramTypes();

  const [filters, setFilters] = useState<SessionLogFilters>({});
  const [subjectBroadCat, setSubjectBroadCat] = useState<"" | "academic" | "beyond_academic" | "college_counselling">("");
  const [filterCurriculumId, setFilterCurriculumId] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterBaseKey, setFilterBaseKey] = useState("");
  const [filterLevelSubjectId, setFilterLevelSubjectId] = useState("");
  const [filterProgramSelection, setFilterProgramSelection] = useState("");

  const { logs, loading } = useSessionLogs(filters, undefined, student.id);

  const teacherNameLookup = new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()]));
  const subjectLookup = new Map(subjects.map((s) => [s.id, s.name]));
  const curriculumLookup = new Map(curricula.map((c) => [c.id, c.name]));

  const performanceCoaches = teachers.filter((t) => t.is_performance_coach);
  // The "Type of program" filter shows the top-level program types a student
  // could actually have sessions under — everything except Ascend Offline Work,
  // which is internal work with no student attached.
  const EXCLUDED_STUDENT_PROGRAM_TYPE_KINDS = new Set(["ascend_offline_work"]);
  const parentProgramTypes = programTypes.filter(
    (p) => p.parent_id === null && p.is_active && (p.type == null || !EXCLUDED_STUDENT_PROGRAM_TYPE_KINDS.has(p.type)),
  );

  const isRealProgramType = filterProgramSelection !== "" &&
    filterProgramSelection !== "__academic__" &&
    filterProgramSelection !== "__beyond_academic__";

  const subProgramTypes = isRealProgramType
    ? programTypes.filter((p) => p.parent_id === Number(filterProgramSelection) && p.is_active)
    : [];

  // Academic subject picking follows the real Curriculum → Group → Subject →
  // Level hierarchy (see db/docs/SUBJECT_HIERARCHY.md), the same cascade the
  // session-log form uses. SL/HL are separate subject rows sharing one name, so
  // they're grouped by base name (groupSubjectsByBase) into a single "Subject"
  // choice plus a "Level" step — never a flat list that shows "Biology" twice.
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

  // Beyond Academic and College Counselling are each ONE flat Subject dropdown —
  // no "Section"/grouping step at all (see db/docs/SUBJECT_HIERARCHY.md §3/§3b),
  // exactly like the session-log form. Beyond Academic is the loose catch-all
  // "not academic and not college counselling"; College Counselling is its own
  // category. Both sorted alphabetically.
  const flatSubjectsSorted = (predicate: (category: string | null) => boolean) =>
    subjects
      .filter((s) => s.is_active && predicate(s.category))
      .sort((a, b) => a.name.localeCompare(b.name));
  const beyondSubjects =
    subjectBroadCat === "beyond_academic"
      ? flatSubjectsSorted((c) => c !== "academic" && c !== "college_counselling")
      : [];
  const collegeSubjects =
    subjectBroadCat === "college_counselling"
      ? flatSubjectsSorted((c) => c === "college_counselling")
      : [];

  // The subject ids the academic Subject/Level pick matches — level-agnostic
  // (both SL & HL) until a level is chosen. Applied to the rows client-side, so
  // "Biology" alone shows every Biology session regardless of level.
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
    setSubjectBroadCat("");
    setFilterProgramSelection("");
    resetSubjectCascade();
  }

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
      header: "Teacher",
      accessor: (l) => l.teacher_id ? (teacherNameLookup.get(l.teacher_id) ?? "—") : <span className="text-navy-300">—</span>,
    },
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
      header: "Recording",
      accessor: (l) =>
        l.video_link ? (
          <a href={l.video_link} target="_blank" rel="noopener noreferrer" className="text-sky-500 underline text-sm whitespace-nowrap font-medium">
            View ↗
          </a>
        ) : (
          <span className="text-navy-300">—</span>
        ),
    },
  ];

  return (
    <>
      <Card className="p-4 mb-4">
        <p className="font-semibold text-navy-700 mb-3">Filter sessions</p>
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
          <SelectInput label="Teacher" placeholder="All teachers" value={filters.teacherId ? String(filters.teacherId) : ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, teacherId: e.target.value ? Number(e.target.value) : undefined }))}
            options={teachers.map((t) => ({ value: String(t.id), label: `${t.first_name} ${t.last_name ?? ""}`.trim() }))} />
          <SelectInput label="Performance Coach" placeholder="All performance coaches" value={filters.coordinatorId ? String(filters.coordinatorId) : ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, coordinatorId: e.target.value ? Number(e.target.value) : undefined }))}
            options={performanceCoaches.map((t) => ({ value: String(t.id), label: `${t.first_name} ${t.last_name ?? ""}`.trim() }))} />
          <SelectInput label="No Show" placeholder="All sessions" value={filters.noShowType ?? ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, noShowType: e.target.value ? (e.target.value as SessionLogFilters['noShowType']) : undefined }))}
            options={NO_SHOW_OPTIONS} />
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
        </div>
        <div className="flex justify-end mt-3">
          <Button size="sm" variant="ghost" onClick={clearAll}>Clear all</Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <p className="font-semibold text-navy-700 px-5 pt-5 pb-3">Session logs</p>
        <div className="px-5 pb-5">
          <DataTable
            columns={columns}
            rows={visibleLogs}
            getRowId={(l) => l.id}
            loading={loading}
            emptyMessage="No sessions logged yet."
          />
        </div>
      </Card>
    </>
  );
}
