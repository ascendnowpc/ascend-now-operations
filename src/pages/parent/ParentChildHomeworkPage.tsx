import { ParentChildScreen } from "./ParentChildScreen";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { useStudentHomework } from "../../hooks/useStudentHomework";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useTeachers } from "../../hooks/useTeachers";
import {
  STAGE_LABEL,
  STAGE_BADGE,
  assignHomeworkNumbers,
  paperDisplayName,
  gradeEffectiveTotal,
  gradeMaxTotal,
} from "../../utils/homeworkGrading";
import { isOutstanding, homeworkTally } from "../../utils/parentHomework";
import type { Student } from "../../types/database";

function Stat({ label, value, tone = "navy" }: { label: string; value: string; tone?: "navy" | "amber" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-navy-400">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${tone === "amber" ? "text-amber-600" : "text-navy-700"}`}>
        {value}
      </p>
    </Card>
  );
}

/**
 * A child's homework as a parent needs it: what's been set, what's still
 * outstanding, and what came back marked.
 *
 * Deliberately NOT the student's own My Homework page: that one links each
 * paper through to the attempt screen, and a parent must never be able to open
 * — let alone answer — their child's homework. (RLS backs that up: the
 * submissions write policy is scoped to the student's own record, so a parent
 * could not save an answer even by reaching the page.) So this lists the same
 * papers with no link out.
 *
 * Outstanding is the headline number, and it counts a started-but-unsubmitted
 * paper too — see utils/parentHomework.
 */
function HomeworkView({ student }: { student: Student }) {
  const { items, loading } = useStudentHomework(student.id);
  const { subjects } = useAllSubjects();
  const { teachers } = useTeachers();

  if (loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      </Card>
    );
  }

  const subjectName = (id: number | null) => (id != null ? subjects.find((s) => s.id === id)?.name ?? null : null);
  const teacherName = (id: string | null) => {
    const t = id != null ? teachers.find((row) => row.id === id) : undefined;
    return t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : null;
  };

  const numbers = assignHomeworkNumbers(items.map((i) => i.paper));
  const tally = homeworkTally(items);

  // Outstanding first — the reason a parent opened this page — then the rest
  // newest-first, which is the order useStudentHomework already returns.
  const ordered = [
    ...items.filter((i) => isOutstanding(i.stage)),
    ...items.filter((i) => !isOutstanding(i.stage)),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Assigned" value={String(tally.assigned)} />
        <Stat label="Not done" value={String(tally.outstanding)} tone={tally.outstanding > 0 ? "amber" : "navy"} />
        <Stat label="Submitted" value={String(tally.submitted)} />
        <Stat label="Graded" value={String(tally.graded)} />
      </div>

      <Card className="p-5">
        {items.length === 0 ? (
          <p className="text-sm text-navy-400">No homework assigned yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-navy-400 uppercase tracking-wide">
                  <th className="py-2 pr-4">Homework</th>
                  <th className="py-2 pr-4">Set by</th>
                  <th className="py-2 pr-4">Assigned</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map(({ paper, grade, stage }) => (
                  <tr key={paper.id} className="border-t border-navy-50">
                    <td className="py-2.5 pr-4 text-navy-700 font-medium">
                      {paperDisplayName(paper, subjectName, numbers.get(paper.id) ?? 0)}
                    </td>
                    <td className="py-2.5 pr-4 text-navy-500">{teacherName(paper.created_by_teacher_id) ?? "—"}</td>
                    <td className="py-2.5 pr-4 text-navy-500 whitespace-nowrap">
                      {new Date(paper.published_at ?? paper.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${STAGE_BADGE[stage]}`}>
                        {STAGE_LABEL[stage]}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-semibold text-navy-700 whitespace-nowrap">
                      {stage === "graded" && grade
                        ? `${gradeEffectiveTotal(grade)} / ${gradeMaxTotal(grade)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ParentChildHomeworkPage() {
  return (
    <ParentChildScreen
      title="Homework"
      render={(student) => <HomeworkView student={student} />}
    />
  );
}
