import { useEffect, useState } from "react";
import { ParentChildScreen } from "./ParentChildScreen";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { useSessionLogs } from "../../hooks/useSessionLogs";
import { useStudentPackages } from "../../hooks/useStudentPackages";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { formatHours } from "../../utils/formatHours";
import { subjectLabel } from "../../utils/subjectLabel";
import { NO_SHOW_LABELS, getSessionSubjectLabel } from "../../utils/sessionLogDisplay";
import {
  monthlySubjectActivity,
  monthLabel,
  sessionLengthSummary,
  noShowBreakdown,
} from "../../utils/parentActivity";
import { useFamilyPackageUsage } from "../../hooks/useFamilyPackageUsage";
import { isFamilyPackage, familyUsageColumns, studentHoursUsed, studentPackageTotals } from "../../utils/familyPackages";
import type { Student, StudentPackage } from "../../types/database";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-navy-400">{label}</p>
      <p className="text-2xl font-semibold text-navy-700 mt-1">{value}</p>
      {hint && <p className="text-xs text-navy-300 mt-1">{hint}</p>}
    </Card>
  );
}

/**
 * Everything a parent asks about how the hours are being spent, on one page:
 * the package balances, the lessons that happened each month broken down by
 * subject, how long a lesson actually runs, and the no-shows.
 *
 * All of it is derived from the same session logs the student's own Session
 * Logs tab lists — the aggregation lives in utils/parentActivity so the
 * counting rules (a no-show is never a session; only No Show + costs hours)
 * are stated once and unit-tested rather than reimplemented in JSX.
 */
function ActivityView({ student }: { student: Student }) {
  const { logs, loading: logsLoading } = useSessionLogs({}, undefined, student.id);
  const { fetchPackagesForStudent } = useStudentPackages();
  const { courseTypes } = useCourseTypes();
  const { subjects } = useSubjects();
  const { curricula } = useCurricula();

  const [packages, setPackages] = useState<StudentPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);

  // A shared pool's `hours_used` belongs to the family, and this page is about
  // one child, so the per-sibling split is what turns it back into "what has
  // this child had" — a column each, the viewed child's highlighted. Purchased
  // and Remaining stay the pool's, so the row adds up across the children.
  const { usageByPackage, loading: usageLoading } = useFamilyPackageUsage(
    packages.filter(isFamilyPackage).map((p) => p.id),
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPackagesLoading(true);
      const rows = await fetchPackagesForStudent(student.id);
      if (cancelled) return;
      setPackages(rows);
      setPackagesLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [student.id, fetchPackagesForStudent]);

  // The usage aggregate is part of the loading gate rather than something the
  // numbers settle into: without it a shared pool would paint the family's
  // hours first and correct itself to this child's a moment later.
  if (logsLoading || packagesLoading || usageLoading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
      </Card>
    );
  }

  const months = monthlySubjectActivity(logs);
  const length = sessionLengthSummary(logs);
  const noShows = noShowBreakdown(logs);

  const courseTypeName = (id: number | null) =>
    (id != null ? courseTypes.find((c) => c.id === id)?.name : undefined) ?? "Package";
  // Same labelling the Session Logs tab uses, so a subject reads identically
  // in the breakdown and in the list a parent clicks through to. The lookup
  // carries the level (SL/HL are separate subject rows sharing one name), which
  // would otherwise render as two indistinguishable "Biology" rows here.
  const subjectLookup = new Map(subjects.map((s) => [s.id, subjectLabel(s.name, s.level)]));
  const curriculumLookup = new Map(curricula.map((c) => [c.id, c.name]));
  const subjectName = (subjectId: number | null, curriculumId: number | null) =>
    getSessionSubjectLabel(subjectId, curriculumId, subjectLookup, curriculumLookup);

  // The tiles read this child's used hours against the pools' remaining ones,
  // because what is left to book is a family fact — so once a sibling has
  // spent anything, purchased − used won't equal it. The table below is where
  // that difference is accounted for, a column per child.
  const totals = studentPackageTotals(packages, student.id, usageByPackage);

  // One column per child who has drawn on these pools, this child's always
  // among them. With no sibling to tell it apart from, the highlight would be
  // marking the only column there is, so it only appears once there are two.
  const usageColumns = familyUsageColumns(usageByPackage, {
    studentId: student.id,
    firstName: student.first_name,
  });
  const isViewed = (studentId: string) => usageColumns.length > 1 && studentId === student.id;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Hours remaining" value={formatHours(totals.remaining)} hint={`of ${formatHours(totals.purchased)} purchased`} />
        <Stat label="Hours used" value={formatHours(totals.used)} />
        <Stat
          label="Average lesson"
          value={length.averageHours != null ? `${formatHours(length.averageHours)} hrs` : "—"}
          hint={
            length.shortestHours != null && length.longestHours != null && length.shortestHours !== length.longestHours
              ? `${formatHours(length.shortestHours)}–${formatHours(length.longestHours)} hrs`
              : undefined
          }
        />
        <Stat
          label="No shows"
          value={String(noShows.total)}
          hint={noShows.hoursLost > 0 ? `${formatHours(noShows.hoursLost)} hrs deducted` : undefined}
        />
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-navy-700 mb-3">Packages</h3>
        {packages.length === 0 ? (
          <p className="text-sm text-navy-400">No packages yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-navy-400 uppercase tracking-wide">
                  <th className="py-2 pr-4">Package</th>
                  <th className="py-2 pr-4 text-right">Purchased</th>
                  {usageColumns.map((c) => (
                    <th
                      key={c.studentId}
                      className={`py-2 px-3 text-right ${isViewed(c.studentId) ? "bg-sky-50 text-sky-600" : ""}`}
                    >
                      {c.firstName}
                    </th>
                  ))}
                  <th className="py-2 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} className="border-t border-navy-50">
                    <td className="py-2 pr-4 text-navy-700">
                      {courseTypeName(p.course_type_id)}
                      {p.pool_label ? <span className="text-navy-400"> · {p.pool_label}</span> : null}
                    </td>
                    <td className="py-2 pr-4 text-right text-navy-700">{formatHours(p.total_hours_purchased ?? 0)}</td>
                    {usageColumns.map((c) => (
                      <td
                        key={c.studentId}
                        className={`py-2 px-3 text-right ${
                          isViewed(c.studentId) ? "bg-sky-50 text-sky-700 font-semibold" : "text-navy-700"
                        }`}
                      >
                        {formatHours(studentHoursUsed(p, c.studentId, usageByPackage))}
                      </td>
                    ))}
                    <td className="py-2 text-right font-semibold text-navy-700">
                      {formatHours(Math.max((p.total_hours_purchased ?? 0) - (p.hours_used ?? 0), 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {noShows.total > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-navy-700 mb-3">No shows</h3>
          <div className="flex flex-wrap gap-2">
            {noShows.byType.map((t) => (
              <span
                key={t.type}
                className="inline-flex items-center gap-2 rounded-pill bg-amber-50 border border-amber-100 px-3 py-1 text-xs font-medium text-amber-700"
              >
                {NO_SHOW_LABELS[t.type] ?? t.type}
                <span className="font-semibold">{t.count}</span>
                {t.hoursLost > 0 && <span className="text-amber-500">· {formatHours(t.hoursLost)} hrs</span>}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-navy-700 mb-3">By month</h3>
        {months.length === 0 ? (
          <p className="text-sm text-navy-400">No sessions logged yet.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {months.map((m) => (
              <div key={m.key}>
                <div className="flex items-baseline justify-between gap-3 border-b border-navy-50 pb-1.5">
                  <p className="text-sm font-semibold text-navy-700">{monthLabel(m.year, m.month)}</p>
                  <p className="text-xs text-navy-400">
                    {m.sessions} session{m.sessions !== 1 ? "s" : ""}
                    {m.noShows > 0 && ` · ${m.noShows} no-show${m.noShows !== 1 ? "s" : ""}`}
                    {` · ${formatHours(m.hours)} hrs`}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <tbody>
                      {m.subjects.map((s) => (
                        <tr key={`${s.subjectId ?? "none"}:${s.curriculumId ?? "none"}`} className="border-b border-navy-50 last:border-b-0">
                          <td className="py-2 pr-4 text-navy-700">{subjectName(s.subjectId, s.curriculumId)}</td>
                          <td className="py-2 pr-4 text-right text-navy-500 whitespace-nowrap">
                            {s.sessions} session{s.sessions !== 1 ? "s" : ""}
                            {s.noShows > 0 && ` · ${s.noShows} no-show${s.noShows !== 1 ? "s" : ""}`}
                          </td>
                          <td className="py-2 text-right font-semibold text-navy-700 whitespace-nowrap">
                            {formatHours(s.hours)} hrs
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ParentChildActivityPage() {
  return (
    <ParentChildScreen
      title="Activity"
      render={(student) => <ActivityView student={student} />}
    />
  );
}
