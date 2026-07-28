import { useEffect, useState } from "react";
import { Card } from "../ui/Card";
import { StarRating } from "../ui/StarRating";
import { subjectRowLabel, subjectCategoryOf, baselineWithDate } from "./CoordinatorLogSubjectPicker";
import { useCoordinatorLogOptions } from "../../hooks/useCoordinatorLogOptions";
import { fetchSubjectGradeHistoryForStudent, type SubjectGradeHistoryEntry } from "../../hooks/useCoordinatorLogs";
import { useStudents } from "../../hooks/useStudents";
import { useTeachers } from "../../hooks/useTeachers";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups } from "../../hooks/useCurriculumGroups";
import type { CoordinatorLog, CoordinatorLogSubject, CoordinatorLogPackageStatus } from "../../types/database";

const RENEWAL_LABEL: Record<string, string> = { not_due: "Not Due", upcoming: "Upcoming", in_discussion: "In Discussion", renewed: "Renewed", not_renewing: "Not Renewing" };
const RELATIONSHIP_OWNER_LABEL: Record<string, string> = { devi: "Devi", pc_cc: "PC/CC", ascend_now_system: "Ascend Now (System)" };

function formatMonthYear(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function shortDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-navy-400">{label}</p>
      <p className="text-sm font-medium text-navy-700 mt-0.5">{value || <span className="text-navy-300 font-normal">—</span>}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 flex flex-col gap-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-navy-400">{title}</h2>
      {children}
    </Card>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-bold uppercase tracking-wide text-navy-500">{children}</h3>;
}

// The full read-only body of a coordinator log (all sections), shared by the
// detail page (/…/coordinator-logs/:id) and the student-detail tab so both
// show identical, complete detail.
export function CoordinatorLogSections({ log }: { log: CoordinatorLog & { subjects: CoordinatorLogSubject[]; package_statuses?: CoordinatorLogPackageStatus[] } }) {
  const { students } = useStudents();
  const { teachers } = useTeachers();
  const { courseTypes } = useCourseTypes();
  const { subjects: allSubjects } = useAllSubjects();
  const { curricula } = useCurricula();
  const { groups: allGroups } = useAllCurriculumGroups();
  const { options: primaryGoalOptions } = useCoordinatorLogOptions("primary_goal");
  const { options: progressStatusOptions } = useCoordinatorLogOptions("progress_status");
  const { options: biggestChallengeOptions } = useCoordinatorLogOptions("biggest_challenge");
  const { options: nextActionOptions } = useCoordinatorLogOptions("next_action");

  // Cross-log current-grade history for this student, so each academic subject
  // shows its whole grade timeline up to this log (not just this log's value).
  const [gradeHistory, setGradeHistory] = useState<Record<string, SubjectGradeHistoryEntry[]>>({});
  useEffect(() => {
    let cancelled = false;
    fetchSubjectGradeHistoryForStudent(log.student_id).then((m) => { if (!cancelled) setGradeHistory(m); });
    return () => { cancelled = true; };
  }, [log.student_id, log.id]);

  const student = students.find((s) => s.id === log.student_id);
  const teacher = teachers.find((t) => t.id === log.teacher_id);
  const optionLabel = (options: { id: number; label: string }[], optionId: number | null) =>
    optionId != null ? options.find((o) => o.id === optionId)?.label ?? "—" : "—";

  const programNames = (log.course_type_ids ?? [])
    .map((id) => courseTypes.find((c) => c.id === id)?.name ?? `Type ${id}`)
    .join(", ");

  const academicRows = log.subjects.filter((s) => subjectCategoryOf(s.subject_id, allSubjects) === "academic");
  const beyondRows = log.subjects.filter((s) => subjectCategoryOf(s.subject_id, allSubjects) === "beyond_academic");
  const collegeRows = log.subjects.filter((s) => subjectCategoryOf(s.subject_id, allSubjects) === "college_counselling");
  const rowLabel = (s: CoordinatorLogSubject) => subjectRowLabel(s.subject_id, s.curriculum_id, allSubjects, curricula, allGroups);
  const hasSubjectContent = academicRows.length > 0 || beyondRows.length > 0 || collegeRows.length > 0;

  // One column per earlier log (up to this log's date) that recorded a grade
  // for any academic subject — the same left→right timeline the form shows.
  const gradeCols = (() => {
    const seen = new Map<number, string>();
    for (const s of academicRows) {
      for (const e of gradeHistory[`${s.subject_id}:${s.curriculum_id ?? ""}`] ?? []) {
        if (e.current_grade != null && e.log_date <= log.log_date) seen.set(e.log_id, e.log_date);
      }
    }
    return [...seen.entries()]
      .map(([log_id, log_date]) => ({ log_id, log_date }))
      .sort((a, b) => a.log_date.localeCompare(b.log_date) || a.log_id - b.log_id);
  })();
  const gradeFor = (s: CoordinatorLogSubject, logId: number) =>
    (gradeHistory[`${s.subject_id}:${s.curriculum_id ?? ""}`] ?? []).find((e) => e.log_id === logId)?.current_grade ?? "—";

  return (
    <div className="flex flex-col gap-5">
      <Section title="Student & Program">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Student" value={student ? `${student.id} — ${student.first_name} ${student.last_name}` : log.student_id} />
          <Field label="Performance Coach" value={teacher ? `${teacher.first_name} ${teacher.last_name ?? ""}`.trim() : "—"} />
          <Field label="Type of program" value={programNames} />
          <Field label="Primary Relationship Owner" value={log.primary_relationship_owner ? RELATIONSHIP_OWNER_LABEL[log.primary_relationship_owner] : null} />
        </div>
      </Section>

      <Section title="Subjects & Profile Building">
        {!hasSubjectContent ? (
          <p className="text-sm text-navy-300">—</p>
        ) : (
          <>
            {academicRows.length > 0 && (
              <div className="flex flex-col gap-2">
                <SubHeading>Academic Subjects &amp; Baseline Scores</SubHeading>
                <div className="overflow-x-auto rounded-xl border border-navy-100">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-navy-50 text-left text-xs font-semibold text-navy-500 uppercase tracking-wide">
                        <th className="px-4 py-2">Subject</th>
                        <th className="px-4 py-2 whitespace-nowrap">Baseline Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {academicRows.map((s) => (
                        <tr key={s.id} className="border-t border-navy-50">
                          <td className="px-4 py-2 font-medium text-navy-700">{rowLabel(s)}</td>
                          <td className="px-4 py-2 text-navy-600 whitespace-nowrap">{baselineWithDate(s.baseline_score, s.baseline_score_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {beyondRows.length > 0 && (
              <div className="flex flex-col gap-2">
                <SubHeading>Profile Building Project</SubHeading>
                <ul className="list-disc list-inside text-sm text-navy-700">
                  {beyondRows.map((s) => <li key={s.id}>{rowLabel(s)}</li>)}
                </ul>
              </div>
            )}

            {collegeRows.length > 0 && (
              <div className="flex flex-col gap-2">
                <SubHeading>College Counselling</SubHeading>
                <ul className="list-disc list-inside text-sm text-navy-700">
                  {collegeRows.map((s) => <li key={s.id}>{rowLabel(s)}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Goals & Progress">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Primary Goal" value={optionLabel(primaryGoalOptions, log.primary_goal_option_id)} />
          <Field label="Ideal Outcome" value={log.ideal_outcome} />
          <Field label="Goal Timeline" value={formatMonthYear(log.goal_timeline)} />
          <Field label="Progress Status" value={optionLabel(progressStatusOptions, log.progress_status_option_id)} />
          <Field label="Biggest Challenge" value={optionLabel(biggestChallengeOptions, log.biggest_challenge_option_id)} />
          <Field label="Next Action" value={optionLabel(nextActionOptions, log.next_action_option_id)} />
        </div>
      </Section>

      <Section title="Final Outcomes">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Final Outcome - University Placement" value={log.final_outcome_university_placement} />
          <Field label="Final Outcome - Project Achievement" value={log.final_outcome_project_achievement} />
          <Field label="Evidence Link for Profile Building" value={log.evidence_link_profile_building ? (
            <a href={log.evidence_link_profile_building} target="_blank" rel="noopener noreferrer" className="text-sky-500 underline">{log.evidence_link_profile_building}</a>
          ) : null} />
        </div>
        {academicRows.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-1.5">Current Grades</p>
            <div className="overflow-x-auto rounded-xl border border-navy-100">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-navy-50 text-left text-xs font-semibold text-navy-500 uppercase tracking-wide">
                    <th className="px-4 py-2">Subject</th>
                    <th className="px-4 py-2 whitespace-nowrap">Baseline</th>
                    {gradeCols.map((c) => (
                      <th key={c.log_id} className="px-4 py-2 whitespace-nowrap">{shortDate(c.log_date)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {academicRows.map((s) => (
                    <tr key={s.id} className="border-t border-navy-50">
                      <td className="px-4 py-2 font-medium text-navy-700">{rowLabel(s)}</td>
                      <td className="px-4 py-2 text-navy-600 whitespace-nowrap">{baselineWithDate(s.baseline_score, s.baseline_score_date)}</td>
                      {gradeCols.map((c) => (
                        <td key={c.log_id} className="px-4 py-2 text-navy-600 whitespace-nowrap">{gradeFor(s, c.log_id)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      <Section title="Ratings">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StarRating label="Student Engagement" value={log.student_engagement_rating} readOnly />
          <StarRating label="Parent Engagement" value={log.parent_engagement_rating} readOnly />
          <StarRating label="Academic Progress" value={log.academic_progress_rating} readOnly />
          <StarRating label="Referral Potential" value={log.referral_potential_rating} readOnly />
          <StarRating label="Engagement" helperText="How involved are the parents?" value={log.parent_involvement_rating} readOnly />
          <StarRating label="Transformation / Outcomes" helperText="Did the student actually grow?" value={log.transformation_outcomes_rating} readOnly />
          <StarRating label="Loyalty / Retention" helperText="How committed are they?" value={log.loyalty_retention_rating} readOnly />
          <StarRating label="Referral / Advocacy" value={log.referral_advocacy_rating} readOnly />
          <StarRating label="Parent Belief Score" value={log.parent_belief_rating} readOnly />
        </div>
      </Section>

      <RenewalSection packageStatuses={log.package_statuses ?? []} referralStatusOptionId={log.referral_status_option_id} />
    </div>
  );
}

// The "Renewal & Referral" block. Renewal Status / Renewal Timing are shown
// **per package** (each package/pool has its own status) and are entirely
// system-maintained — they come from this log's own snapshot
// (coordinator_log_package_statuses), taken when the log was filed. The dated
// change history is the coordinator-log history itself: the system files a
// new log whenever any package's status changes. Referral Status is the one
// manual field, from the log.
export function RenewalSection({
  packageStatuses,
  referralStatusOptionId,
}: {
  packageStatuses: CoordinatorLogPackageStatus[];
  referralStatusOptionId?: number | null;
}) {
  const { courseTypes } = useCourseTypes();
  const { options: referralStatusOptions } = useCoordinatorLogOptions("referral_status");

  // Mirror the hours-view naming exactly (StudentDetailView): a bundle
  // (package_type_id, e.g. All-In-One) is the heading, and each pool under it is
  // identified by its pool_label, falling back to its own course type when it
  // has no pool_label (e.g. College Counselling sitting inside the All-In-One
  // bundle). Without the fallback such a pool collapsed to a bare "All-In-One"
  // and lost which package it was. Standalone packages (no bundle) show the leaf
  // alone.
  const packageName = (courseTypeId: number | null, packageTypeId: number | null, poolLabel: string | null) => {
    const courseName = courseTypes.find((c) => c.id === courseTypeId)?.name;
    const bundleName = packageTypeId != null ? courseTypes.find((c) => c.id === packageTypeId)?.name : null;
    const leaf = poolLabel ?? courseName ?? "—";
    return bundleName ? `${bundleName} · ${leaf}` : leaf;
  };
  const referralLabel = referralStatusOptionId != null
    ? referralStatusOptions.find((o) => o.id === referralStatusOptionId)?.label ?? "—"
    : "—";

  return (
    <Section title="Renewal & Referral">
      <div className="flex flex-col gap-2">
        <SubHeading>Per-package status (automatic)</SubHeading>
        {packageStatuses.length === 0 ? (
          <p className="text-sm text-navy-300">—</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-navy-100">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-navy-50 text-left text-xs font-semibold text-navy-500 uppercase tracking-wide">
                  <th className="px-4 py-2">Package</th>
                  <th className="px-4 py-2">Renewal Status</th>
                  <th className="px-4 py-2 whitespace-nowrap">Renewal Timing</th>
                </tr>
              </thead>
              <tbody>
                {packageStatuses.map((s) => (
                  <tr key={s.id} className="border-t border-navy-50">
                    <td className="px-4 py-2 font-medium text-navy-700">{packageName(s.course_type_id, s.package_type_id, s.pool_label)}</td>
                    <td className="px-4 py-2 text-navy-600">{RENEWAL_LABEL[s.renewal_status]}</td>
                    <td className="px-4 py-2 text-navy-600 whitespace-nowrap">{formatMonthYear(s.renewal_timing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Field label="Referral Status" value={referralLabel} />
    </Section>
  );
}
