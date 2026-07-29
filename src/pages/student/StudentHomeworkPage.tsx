import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StudentLayout } from "./StudentLayout";
import { PageHeader } from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { SelectInput } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { useMyStudent } from "../../hooks/useMyStudent";
import { useStudentHomework, type StudentHomeworkItem } from "../../hooks/useStudentHomework";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useTeachers } from "../../hooks/useTeachers";
import {
  STAGE_LABEL,
  STAGE_BADGE,
  STAGE_ORDER,
  gradeEffectiveTotal,
  gradeMaxTotal,
  assignHomeworkNumbers,
} from "../../utils/homeworkGrading";

function ItemRow({
  item,
  number,
  subjectName,
  teacherName,
}: {
  item: StudentHomeworkItem;
  number: number;
  subjectName: (id: number | null) => string | null;
  teacherName: (id: string | null) => string | null;
}) {
  const { paper, grade, stage } = item;
  const totalQ = paper.questions_json?.total_questions ?? 0;
  const score =
    stage === "graded" && grade
      ? `${gradeEffectiveTotal(grade)} / ${gradeMaxTotal(grade)}`
      : null;
  const teacher = teacherName(paper.created_by_teacher_id);
  const assignedDate = paper.published_at ?? paper.created_at;
  return (
    <Link
      to={`/student/homework/${paper.id}`}
      className="flex h-full flex-col rounded-2xl border border-navy-100 bg-white p-5 shadow-sm transition-all hover:border-sky-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sky-300"
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-base font-bold text-sky-600">
          {number}
        </span>
        <span className={`shrink-0 rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${STAGE_BADGE[stage]}`}>
          {score ?? STAGE_LABEL[stage]}
        </span>
      </div>
      <p className="mb-2 font-semibold text-navy-700">
        {subjectName(paper.subject_id) ?? "Homework"}
      </p>
      <div className="mt-auto space-y-1 text-xs text-navy-400">
        {teacher && <p>By {teacher}</p>}
        <p>
          {totalQ} {totalQ === 1 ? "question" : "questions"}
          {paper.difficulty ? ` · ${paper.difficulty}` : ""}
        </p>
        <p>Assigned {new Date(assignedDate).toLocaleDateString()}</p>
      </div>
    </Link>
  );
}

export default function StudentHomeworkPage() {
  const { student, loading: studentLoading } = useMyStudent();
  const { items, loading, error } = useStudentHomework(student?.id);
  const { subjects } = useAllSubjects();
  const { teachers } = useTeachers();

  const [teacherFilter, setTeacherFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");

  const subjectName = useMemo(() => {
    const m = new Map(subjects.map((s) => [s.id, s.name]));
    return (id: number | null) => (id != null ? (m.get(id) ?? null) : null);
  }, [subjects]);

  const teacherName = useMemo(() => {
    const m = new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()]));
    return (id: string | null) => (id != null ? (m.get(id) ?? null) : null);
  }, [teachers]);

  // Only offer teachers/subjects that actually appear on this student's papers,
  // so the dropdowns stay short and every option returns at least one result.
  const teacherOptions = useMemo(() => {
    const ids = [...new Set(items.map((i) => i.paper.created_by_teacher_id).filter((id): id is string => id != null))];
    return ids
      .map((id) => ({ value: String(id), label: teacherName(id) ?? `Teacher ${id}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items, teacherName]);

  const subjectOptions = useMemo(() => {
    const ids = [...new Set(items.map((i) => i.paper.subject_id).filter((id): id is number => id != null))];
    return ids
      .map((id) => ({ value: String(id), label: subjectName(id) ?? `Subject ${id}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items, subjectName]);

  // Homework numbers are assigned over every paper (stable per-student serial),
  // independent of the current filter, so a paper keeps its number when filtered.
  const homeworkNumbers = assignHomeworkNumbers(items.map((i) => i.paper));

  const filteredItems = items.filter((i) => {
    if (teacherFilter && String(i.paper.created_by_teacher_id) !== teacherFilter) return false;
    if (subjectFilter && String(i.paper.subject_id) !== subjectFilter) return false;
    return true;
  });

  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    rows: filteredItems.filter((i) => i.stage === stage),
  })).filter((g) => g.rows.length > 0);

  const hasFilters = Boolean(teacherFilter || subjectFilter);

  return (
    <StudentLayout>
      <PageHeader
        title="My Homework"
        description="Homework papers your teachers have assigned. Open one to attempt it."
      />
      {studentLoading || loading ? (
        <div className="flex items-center gap-2 text-navy-300 py-12">
          <Spinner /> Loading…
        </div>
      ) : error ? (
        <Card className="p-5">
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-navy-500">No homework yet. Your teachers will assign some.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 items-end">
              <SelectInput
                label="Teacher"
                placeholder="All teachers"
                value={teacherFilter}
                onChange={(e) => setTeacherFilter(e.target.value)}
                options={teacherOptions}
              />
              <SelectInput
                label="Subject"
                placeholder="All subjects"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                options={subjectOptions}
              />
              {hasFilters && (
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTeacherFilter("");
                      setSubjectFilter("");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {byStage.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-navy-500">No homework matches these filters.</p>
            </Card>
          ) : (
            byStage.map(({ stage, rows }) => (
              <section key={stage}>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-navy-400">
                  {STAGE_LABEL[stage]} · {rows.length}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {rows.map((item) => (
                    <ItemRow
                      key={item.paper.id}
                      item={item}
                      number={homeworkNumbers.get(item.paper.id) ?? 0}
                      subjectName={subjectName}
                      teacherName={teacherName}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}
    </StudentLayout>
  );
}
