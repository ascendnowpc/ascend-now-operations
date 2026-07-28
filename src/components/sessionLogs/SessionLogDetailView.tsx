import { useEffect, useState, type ReactNode } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { IconDownload } from "../ui/icons";
import { fetchSessionLogById } from "../../hooks/useSessionLogs";
import { useMonthlyReports, isDateInLockedMonth } from "../../hooks/useMonthlyReports";
import { useProgramTypes } from "../../hooks/useProgramTypes";
import { useTeachers } from "../../hooks/useTeachers";
import { useCurricula } from "../../hooks/useCurricula";
import { useSubjects } from "../../hooks/useSubjects";
import { useStudents } from "../../hooks/useStudents";
import { Spinner } from "../ui/Spinner";
import { downloadSessionDocx } from "../../utils/downloadSessionDocx";
import { InvoiceFilePreview } from "../ui/InvoiceFilePreview";
import { PageHeader } from "../layout/PageHeader";
import type { SessionLog } from "../../types/database";

const NO_SHOW_LABELS: Record<string, string> = {
  no_show_1: "No Show 1",
  no_show_2: "No Show 2",
  no_show_plus: "No Show +",
};

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-3 border-b border-navy-50 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-300">{label}</dt>
      <dd className="mt-1 text-navy-700 break-words">{value}</dd>
    </div>
  );
}

function getProgramTypeLabel(id: number | null, programTypes: { id: number; name: string; parent_id: number | null }[]): string {
  if (!id) return "—";
  const pt = programTypes.find((p) => p.id === id);
  if (!pt) return "—";
  if (pt.parent_id) {
    const parent = programTypes.find((p) => p.id === pt.parent_id);
    if (parent) return `${parent.name} — ${pt.name}`;
  }
  return pt.name;
}

/**
 * Shared session-log DETAIL/view used by BOTH the admin
 * (`/admin/session-logs/:id`) and teacher/coach (`/teacher/sessions/:id`)
 * pages — one component so the full field list can't drift apart again
 * (every field, in the same order, with the same styling, was already
 * copy-pasted identically between them). The two roles differ ONLY in:
 *   - `canEditBase` — whether this role can edit AT ALL before the
 *     locked-month check applies (admin: always; teacher: only if they're
 *     flagged as a performance coach, `teacher?.is_performance_coach`) —
 *     `!isLocked` is ANDed on top of this inside the component, same as
 *     both pages already computed it;
 *   - `showId` — admin's field list starts with the row's raw `id`, the
 *     teacher's doesn't;
 *   - `descriptionWhenUnlocked` — admin always shows "Full session record…"
 *     under the title; the teacher page shows nothing when unlocked
 *     (`undefined`, matching how it already rendered);
 *   - `cardClassName` — the teacher page constrains width (`max-w-2xl`),
 *     admin's doesn't;
 *   - route strings/labels (`backPath`, `editPath`, `notFound*`).
 */
export function SessionLogDetailView({
  backPath,
  backLabel,
  editPath,
  canEditBase,
  showId,
  descriptionWhenUnlocked,
  cardClassName,
  notFoundTitle,
  notFoundMessage,
  notFoundBackLabel,
}: {
  backPath: string;
  backLabel: string;
  editPath: (id: number) => string;
  canEditBase: boolean;
  showId: boolean;
  descriptionWhenUnlocked?: string;
  cardClassName?: string;
  notFoundTitle: string;
  notFoundMessage: string;
  notFoundBackLabel: string;
}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<SessionLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lockedMonths, setLockedMonths] = useState<Set<string>>(new Set());
  const { programTypes } = useProgramTypes();
  const { teachers } = useTeachers();
  const { curricula } = useCurricula();
  const { subjects } = useSubjects();
  const { students } = useStudents();
  const { fetchLockedMonths } = useMonthlyReports();

  useEffect(() => {
    if (!id) return;
    fetchSessionLogById(Number(id)).then(({ data, error }) => {
      // Note: RLS should already prevent a teacher from fetching a session
      // that isn't theirs — this just handles the not-found / no-permission
      // case gracefully on the client, same as both pages already did.
      if (error || !data) setNotFound(true);
      else setLog(data);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    fetchLockedMonths().then(({ data }) => setLockedMonths(data));
  }, [fetchLockedMonths]);

  if (loading) {
    return <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>;
  }

  if (notFound || !log) {
    return (
      <>
        <PageHeader title={notFoundTitle} />
        <p className="text-navy-300">
          {notFoundMessage}{" "}
          <Link to={backPath} className="text-sky-400 underline">
            {notFoundBackLabel}
          </Link>
        </p>
      </>
    );
  }

  const student = log.student_id ? students.find((s) => s.id === log.student_id) : null;
  const studentDisplay = student
    ? `${student.id} — ${student.first_name} ${student.last_name}`
    : `${log.student_first_name ?? ""} ${log.student_last_name ?? ""}`.trim() || "—";

  const programTypeName = getProgramTypeLabel(log.program_type_id, programTypes);
  const teacherName = log.teacher_id
    ? (() => {
        const t = teachers.find((t) => t.id === log.teacher_id);
        return t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : "—";
      })()
    : "—";
  const coordinatorName = log.coordinator_teacher_id
    ? (() => {
        const t = teachers.find((t) => t.id === log.coordinator_teacher_id);
        return t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : "—";
      })()
    : "—";
  // Ascend Offline Work repurposes coordinator_teacher_id as "Assigned by"
  // (which teacher assigned the work) rather than a performance coach.
  const isAscendOfflineWorkLog = log.program_type_id
    ? programTypes.find((p) => p.id === log.program_type_id)?.type === "ascend_offline_work"
    : false;
  const subjectName = log.subject_id
    ? subjects.find((s) => s.id === log.subject_id)?.name ?? "—"
    : "—";
  const curriculumName = log.curriculum_id
    ? curricula.find((c) => c.id === log.curriculum_id)?.name
    : undefined;

  const isLocked = isDateInLockedMonth(log.session_date, lockedMonths);
  const canEdit = canEditBase && !isLocked;

  const lockBadge = (
    <span className="inline-block rounded-pill bg-navy-600 text-white px-2 py-0.5 text-xs font-semibold">🔒 locked</span>
  );

  return (
    <>
      <PageHeader
        title={`Session — ${student ? student.first_name : (log.student_first_name ?? "Student")}`}
        description={
          isLocked ? (
            <span className="inline-flex items-center gap-2">
              {descriptionWhenUnlocked && <>{descriptionWhenUnlocked}</>}
              {lockBadge}
            </span>
          ) : (
            descriptionWhenUnlocked
          )
        }
        action={
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => navigate(backPath)}>
              {backLabel}
            </Button>
            <Button
              variant="secondary"
              className="flex items-center gap-2"
              onClick={() => downloadSessionDocx(log, { studentDisplay, teacherName, coordinatorName, programTypeName, subjectName, curriculumName })}
            >
              <IconDownload /> Download .docx
            </Button>
            {canEdit && <Button onClick={() => navigate(editPath(log.id))}>Edit</Button>}
          </div>
        }
      />

      {/* Scrollable, full-field view — nothing is hidden or truncated. */}
      <Card className={cardClassName ?? "p-6 max-h-[70vh] overflow-y-auto"}>
        <dl>
          {showId && <Field label="ID" value={log.id} />}
          <Field
            label="No Show"
            value={
              log.no_show_type ? (
                <span className="inline-block rounded-pill bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-semibold">
                  {NO_SHOW_LABELS[log.no_show_type] ?? log.no_show_type}
                </span>
              ) : (
                "—"
              )
            }
          />
          <Field label="Student" value={studentDisplay} />
          <Field label="Session date" value={new Date(log.session_date).toLocaleDateString()} />
          <Field label="Teacher" value={teacherName} />
          <Field label={isAscendOfflineWorkLog ? "Assigned by" : "Performance Coach"} value={coordinatorName} />
          <Field label="Program type" value={programTypeName} />
          {curriculumName && <Field label="Curriculum" value={curriculumName} />}
          <Field label="Subject" value={subjectName} />
          <Field label="Topic" value={log.topic ?? "—"} />
          <Field label="Session duration (hrs)" value={log.session_duration_hrs ?? "—"} />
          <Field
            label="Independent work completed"
            value={
              log.independent_work && log.independent_work.length > 0 ? (
                <span className="capitalize">{log.independent_work[0].replace(/_/g, " ")}</span>
              ) : (
                "—"
              )
            }
          />
          <Field
            label="Engagement rating"
            value={
              log.engagement_rating ? (
                <span className={`inline-block rounded-pill px-2 py-0.5 text-xs font-semibold capitalize ${
                  log.engagement_rating === "low"
                    ? "bg-red-100 text-red-700"
                    : log.engagement_rating === "medium"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}>
                  {log.engagement_rating}
                </span>
              ) : (
                "—"
              )
            }
          />
          <Field
            label="Performance feedback"
            value={log.performance_feedback ? <p className="whitespace-pre-wrap text-sm">{log.performance_feedback}</p> : "—"}
          />
          <Field
            label="Flagged for Performance Coach"
            value={
              log.flag_for_coach ? (
                <span className="inline-block rounded-pill bg-red-100 text-red-700 px-2 py-0.5 text-xs font-semibold">
                  {log.flag_category ?? "Flagged"}
                </span>
              ) : (
                "No"
              )
            }
          />
          {log.flag_for_coach && (
            <Field
              label="Flag comments"
              value={log.flag_comments ? <p className="whitespace-pre-wrap text-sm">{log.flag_comments}</p> : "—"}
            />
          )}
          <Field
            label="Video link (Fathom)"
            value={
              log.video_link ? (
                <a href={log.video_link} target="_blank" rel="noreferrer" className="text-sky-400 underline">
                  {log.video_link}
                </a>
              ) : (
                "—"
              )
            }
          />
          {log.fathom_summary && (
            <Field label="Fathom transcript" value={<p className="whitespace-pre-wrap text-sm">{log.fathom_summary}</p>} />
          )}
          {log.invoice_file_url && (
            <Field
              label="Zoom invoice"
              value={<InvoiceFilePreview url={log.invoice_file_url} className="max-w-sm" />}
            />
          )}
          <Field label="Created at" value={new Date(log.created_at).toLocaleString()} />
          <Field label="Last updated" value={new Date(log.updated_at).toLocaleString()} />
        </dl>
      </Card>
    </>
  );
}
