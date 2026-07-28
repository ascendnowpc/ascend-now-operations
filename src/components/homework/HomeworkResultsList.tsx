import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Spinner } from "../ui/Spinner";
import { useStudentHomework } from "../../hooks/useStudentHomework";
import {
  STAGE_LABEL,
  STAGE_BADGE,
  STAGE_ORDER,
  gradeEffectiveTotal,
  gradeMaxTotal,
  assignHomeworkNumbers,
  type HomeworkStage,
} from "../../utils/homeworkGrading";

const filterSelectClass =
  "rounded-lg border border-navy-100 px-2 py-1 text-xs text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300";

// Every homework paper published to one student — named, staged, and scored
// exactly like the student's own "My Homework" list — filterable by subject/
// stage/date, with an optional link into the paper's review page. Shared by
// the PC/admin student-detail "Homework" tab (StudentDetailView.tsx) and the
// PC-only student-results section on the Homework Generator page
// (TeacherHomeworkPage.tsx), so both read the same list the same way.
export function HomeworkResultsList({
  studentId,
  subjectName,
  teacherName,
  linkable = false,
  linkBase = "/teacher/homework",
  emptyMessage = "No homework published for this student yet.",
}: {
  studentId: string | undefined;
  subjectName: (id: number | null) => string | null;
  /** Resolves the assigning teacher's name — when given, shown as "By …". */
  teacherName?: (id: number | null) => string | null;
  /** Wrap each card in a Link to `${linkBase}/:paperId`. */
  linkable?: boolean;
  /** Base path for the paper link — admin views open under /admin/homework. */
  linkBase?: string;
  emptyMessage?: string;
}) {
  const { items, loading, error } = useStudentHomework(studentId);
  const homeworkNumbers = assignHomeworkNumbers(items.map((i) => i.paper));
  const sorted = [...items].sort(
    (a, b) => (homeworkNumbers.get(a.paper.id) ?? 0) - (homeworkNumbers.get(b.paper.id) ?? 0),
  );

  const [subjectFilter, setSubjectFilter] = useState<number | "all">("all");
  const [stageFilter, setStageFilter] = useState<HomeworkStage | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // A filter picked for one student rarely means anything for the next one
  // (e.g. a subject_id they never had a paper in), so switching students
  // clears the filter bar rather than carrying it over silently. Reset during
  // render (React's documented pattern for "adjust state when a prop
  // changes") rather than an effect, so there's no extra render with stale
  // filters applied to the new student's list.
  const [filteredForStudentId, setFilteredForStudentId] = useState(studentId);
  if (studentId !== filteredForStudentId) {
    setFilteredForStudentId(studentId);
    setSubjectFilter("all");
    setStageFilter("all");
    setDateFrom("");
    setDateTo("");
  }

  const availableSubjects = useMemo(() => {
    const ids = new Set(
      items.map((i) => i.paper.subject_id).filter((id): id is number => id != null),
    );
    return [...ids].sort((a, b) => (subjectName(a) ?? "").localeCompare(subjectName(b) ?? ""));
  }, [items, subjectName]);

  const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
  const toMs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
  const filtered = sorted.filter(({ paper, stage }) => {
    if (subjectFilter !== "all" && paper.subject_id !== subjectFilter) return false;
    if (stageFilter !== "all" && stage !== stageFilter) return false;
    const ms = new Date(paper.published_at ?? paper.created_at).getTime();
    if (fromMs != null && ms < fromMs) return false;
    if (toMs != null && ms > toMs) return false;
    return true;
  });

  if (!studentId) {
    return <p className="text-sm text-navy-300">Pick a student first.</p>;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-navy-300 text-sm">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (sorted.length === 0) {
    return <p className="text-sm text-navy-400">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          className={filterSelectClass}
        >
          <option value="all">All subjects</option>
          {availableSubjects.map((id) => (
            <option key={id} value={id}>
              {subjectName(id) ?? `Subject ${id}`}
            </option>
          ))}
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as HomeworkStage | "all")}
          className={filterSelectClass}
        >
          <option value="all">All stages</option>
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="From date"
          className={filterSelectClass}
        />
        <span className="text-xs text-navy-300">–</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="To date"
          className={filterSelectClass}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-navy-400">No homework matches these filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const { paper, grade, stage } = item;
            const totalQ = paper.questions_json?.total_questions ?? 0;
            const score =
              stage === "graded" && grade
                ? `${gradeEffectiveTotal(grade)} / ${gradeMaxTotal(grade)}`
                : null;
            const assignedDate = paper.published_at ?? paper.created_at;
            const inner = (
              <>
                <div className="mb-4 flex items-start justify-between gap-2">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-base font-bold text-sky-600">
                    {homeworkNumbers.get(paper.id) ?? "—"}
                  </span>
                  <span className={`shrink-0 rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${STAGE_BADGE[stage]}`}>
                    {score ?? STAGE_LABEL[stage]}
                  </span>
                </div>
                <p className="mb-2 font-semibold text-navy-700">
                  {subjectName(paper.subject_id) ?? "Homework"}
                </p>
                <div className="mt-auto space-y-1 text-xs text-navy-400">
                  {(() => {
                    const t = teacherName?.(paper.created_by_teacher_id);
                    return t ? <p>By {t}</p> : null;
                  })()}
                  <p>
                    {totalQ} {totalQ === 1 ? "question" : "questions"}
                    {paper.difficulty ? ` · ${paper.difficulty}` : ""}
                  </p>
                  <p>Assigned {new Date(assignedDate).toLocaleDateString()}</p>
                </div>
              </>
            );
            const boxClass =
              "flex h-full flex-col rounded-2xl border border-navy-100 bg-white p-5 shadow-sm transition-all";
            return linkable ? (
              <Link
                key={paper.id}
                to={`${linkBase}/${paper.id}`}
                className={`${boxClass} hover:border-sky-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sky-300`}
              >
                {inner}
              </Link>
            ) : (
              <div key={paper.id} className={boxClass}>
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
