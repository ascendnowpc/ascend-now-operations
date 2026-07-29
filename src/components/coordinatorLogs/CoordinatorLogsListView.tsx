import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../layout/PageHeader";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { SelectInput } from "../ui/Input";
import { DataTable, type ColumnDef } from "../ui/DataTable";
import { StudentSearch } from "../ui/StudentSearch";
import { subjectRowLabel } from "./CoordinatorLogSubjectPicker";
import { useCoordinatorLogs } from "../../hooks/useCoordinatorLogs";
import { useCoordinatorLogOptions } from "../../hooks/useCoordinatorLogOptions";
import { useStudents } from "../../hooks/useStudents";
import { useTeachers } from "../../hooks/useTeachers";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useAllSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups } from "../../hooks/useCurriculumGroups";
import { supabase } from "../../lib/supabaseClient";
import type { CoordinatorLog, CoordinatorLogSubject } from "../../types/database";

const RELATIONSHIP_OWNER_LABEL: Record<string, string> = { devi: "Devi", pc_cc: "PC/CC", ascend_now_system: "Ascend Now (System)" };

function monthYear(d: string | null) {
  return d ? new Date(d).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—";
}
function num(v: number | null) {
  return v != null ? String(v) : "—";
}
function Truncate({ text }: { text: string }) {
  return <span className="inline-block max-w-[16rem] truncate align-bottom" title={text}>{text}</span>;
}

/**
 * Shared Coordinator's Log list, used by both `/admin/coordinator-logs` and
 * `/teacher/coordinator-logs`. Shows every field of each log (spreadsheet
 * style, horizontally scrollable); row click opens the detail view. PCs are
 * scoped to their own assigned students via `scopeToStudentIds`; admin passes
 * `undefined` and sees every log (RLS scopes admin to "all").
 */
export function CoordinatorLogsListView({
  scopeToStudentIds,
  showCoordinatorFilter,
  addLogPath,
  detailPath,
}: {
  scopeToStudentIds?: string[];
  showCoordinatorFilter: boolean;
  addLogPath: string;
  detailPath: (id: number) => string;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Deep link from a student's "Show all logs" button pre-applies that student.
  const [studentFilterId, setStudentFilterId] = useState<string | null>(searchParams.get("student"));
  const [teacherFilterId, setTeacherFilterId] = useState("");
  const [courseTypeFilterId, setCourseTypeFilterId] = useState("");
  const [primaryGoalFilterId, setPrimaryGoalFilterId] = useState("");
  const [progressStatusFilterId, setProgressStatusFilterId] = useState("");
  const [biggestChallengeFilterId, setBiggestChallengeFilterId] = useState("");
  const [nextActionFilterId, setNextActionFilterId] = useState("");
  const [renewalStatusFilterId, setRenewalStatusFilterId] = useState("");
  const [referralStatusFilterId, setReferralStatusFilterId] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { logs, loading } = useCoordinatorLogs(
    {
      studentId: studentFilterId ?? undefined,
      teacherId: teacherFilterId ? teacherFilterId : undefined,
      courseTypeId: courseTypeFilterId ? Number(courseTypeFilterId) : undefined,
      primaryGoalOptionId: primaryGoalFilterId ? Number(primaryGoalFilterId) : undefined,
      progressStatusOptionId: progressStatusFilterId ? Number(progressStatusFilterId) : undefined,
      biggestChallengeOptionId: biggestChallengeFilterId ? Number(biggestChallengeFilterId) : undefined,
      nextActionOptionId: nextActionFilterId ? Number(nextActionFilterId) : undefined,
      renewalStatusOptionId: renewalStatusFilterId ? Number(renewalStatusFilterId) : undefined,
      referralStatusOptionId: referralStatusFilterId ? Number(referralStatusFilterId) : undefined,
      primaryRelationshipOwner: ownerFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    scopeToStudentIds,
  );

  const { students } = useStudents();
  const { teachers } = useTeachers();
  const { courseTypes } = useCourseTypes();
  const { subjects: allSubjects } = useAllSubjects();
  const { curricula } = useCurricula();
  const { groups: allGroups } = useAllCurriculumGroups();
  const { options: progressStatusOptions } = useCoordinatorLogOptions("progress_status");
  const { options: renewalStatusOptions } = useCoordinatorLogOptions("renewal_status");
  const { options: primaryGoalOptions } = useCoordinatorLogOptions("primary_goal");
  const { options: biggestChallengeOptions } = useCoordinatorLogOptions("biggest_challenge");
  const { options: nextActionOptions } = useCoordinatorLogOptions("next_action");
  const { options: referralStatusOptions } = useCoordinatorLogOptions("referral_status");

  // Each log's subjects (baseline + grade improvement) — a separate fetch,
  // since the logs query itself doesn't join the child table.
  const [subjectsByLog, setSubjectsByLog] = useState<Map<number, CoordinatorLogSubject[]>>(new Map());
  const logIdsKey = logs.map((l) => l.id).join(",");
  useEffect(() => {
    if (logs.length === 0) { setSubjectsByLog(new Map()); return; }
    let cancelled = false;
    supabase
      .from("coordinator_log_subjects")
      .select("*")
      .in("coordinator_log_id", logs.map((l) => l.id))
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        const m = new Map<number, CoordinatorLogSubject[]>();
        for (const row of (data ?? []) as CoordinatorLogSubject[]) {
          const arr = m.get(row.coordinator_log_id) ?? [];
          arr.push(row);
          m.set(row.coordinator_log_id, arr);
        }
        setSubjectsByLog(m);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logIdsKey]);

  const studentLookup = new Map(students.map((s) => [s.id, `${s.id} — ${s.first_name} ${s.last_name}`.trim()]));
  const teacherLookup = new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()]));
  const courseTypeLookup = new Map(courseTypes.map((c) => [c.id, c.name]));
  const performanceCoaches = teachers.filter((t) => t.is_performance_coach && t.is_active);

  const label = (options: { id: number; label: string }[], id: number | null) =>
    id != null ? options.find((o) => o.id === id)?.label ?? "—" : "—";
  const subjLabel = (s: CoordinatorLogSubject) => subjectRowLabel(s.subject_id, s.curriculum_id, allSubjects, curricula, allGroups);

  function clearAll() {
    setStudentFilterId(null);
    setTeacherFilterId("");
    setCourseTypeFilterId("");
    setPrimaryGoalFilterId("");
    setProgressStatusFilterId("");
    setBiggestChallengeFilterId("");
    setNextActionFilterId("");
    setRenewalStatusFilterId("");
    setReferralStatusFilterId("");
    setOwnerFilter("");
    setDateFrom("");
    setDateTo("");
  }

  const nowrap = "whitespace-nowrap";
  const columns: ColumnDef<CoordinatorLog>[] = [
    { header: "Date", className: nowrap, accessor: (l) => new Date(l.log_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) },
    { header: "Student", className: nowrap, accessor: (l) => studentLookup.get(l.student_id) ?? l.student_id },
    { header: "Performance Coach", className: nowrap, accessor: (l) => teacherLookup.get(l.teacher_id) ?? "—" },
    { header: "Type of Program", className: nowrap, accessor: (l) => {
      const names = (l.course_type_ids ?? []).map((id) => courseTypeLookup.get(id) ?? `Type ${id}`);
      return names.length > 0 ? names.join(", ") : "—";
    } },
    { header: "Subjects (Baseline)", className: nowrap, accessor: (l) => {
      const subs = subjectsByLog.get(l.id) ?? [];
      return subs.length === 0 ? "—" : <Truncate text={subs.map((s) => `${subjLabel(s)}: ${s.baseline_score ?? "—"}`).join("; ")} />;
    } },
    { header: "Current Grades", className: nowrap, accessor: (l) => {
      const subs = (subjectsByLog.get(l.id) ?? []).filter((s) => s.final_outcome_grade);
      return subs.length === 0 ? "—" : <Truncate text={subs.map((s) => `${subjLabel(s)}: ${s.final_outcome_grade}`).join("; ")} />;
    } },
    { header: "Primary Goal", className: nowrap, accessor: (l) => label(primaryGoalOptions, l.primary_goal_option_id) },
    { header: "Goal Timeline", className: nowrap, accessor: (l) => monthYear(l.goal_timeline) },
    { header: "Progress Status", className: nowrap, accessor: (l) => label(progressStatusOptions, l.progress_status_option_id) },
    { header: "Biggest Challenge", className: nowrap, accessor: (l) => label(biggestChallengeOptions, l.biggest_challenge_option_id) },
    { header: "Next Action", className: nowrap, accessor: (l) => label(nextActionOptions, l.next_action_option_id) },
    { header: "Final Outcome - University Placement", className: nowrap, accessor: (l) => l.final_outcome_university_placement ? <Truncate text={l.final_outcome_university_placement} /> : "—" },
    { header: "Final Outcome - Project Achievement", className: nowrap, accessor: (l) => l.final_outcome_project_achievement ? <Truncate text={l.final_outcome_project_achievement} /> : "—" },
    { header: "Evidence Link", className: nowrap, accessor: (l) => l.evidence_link_profile_building
      ? <a href={l.evidence_link_profile_building} target="_blank" rel="noopener noreferrer" className="text-sky-500 underline" onClick={(e) => e.stopPropagation()}><Truncate text={l.evidence_link_profile_building} /></a>
      : "—" },
    { header: "Student Engagement", className: nowrap, accessor: (l) => num(l.student_engagement_rating) },
    { header: "Parent Engagement", className: nowrap, accessor: (l) => num(l.parent_engagement_rating) },
    { header: "Academic Progress", className: nowrap, accessor: (l) => num(l.academic_progress_rating) },
    { header: "Referral Potential", className: nowrap, accessor: (l) => num(l.referral_potential_rating) },
    { header: "Engagement", className: nowrap, accessor: (l) => num(l.parent_involvement_rating) },
    { header: "Transformation / Outcomes", className: nowrap, accessor: (l) => num(l.transformation_outcomes_rating) },
    { header: "Loyalty / Retention", className: nowrap, accessor: (l) => num(l.loyalty_retention_rating) },
    { header: "Referral / Advocacy", className: nowrap, accessor: (l) => num(l.referral_advocacy_rating) },
    { header: "Parent Belief", className: nowrap, accessor: (l) => num(l.parent_belief_rating) },
    { header: "Renewal Status", className: nowrap, accessor: (l) => label(renewalStatusOptions, l.renewal_status_option_id) },
    { header: "Referral Status", className: nowrap, accessor: (l) => label(referralStatusOptions, l.referral_status_option_id) },
    { header: "Ideal Outcome", className: nowrap, accessor: (l) => l.ideal_outcome ? <Truncate text={l.ideal_outcome} /> : "—" },
    { header: "Primary Relationship Owner", className: nowrap, accessor: (l) => (l.primary_relationship_owner ? RELATIONSHIP_OWNER_LABEL[l.primary_relationship_owner] : "—") },
  ];

  return (
    <>
      <PageHeader
        title="Performance Coach Log"
        action={
          <Button onClick={() => navigate(addLogPath)} className="flex items-center gap-2">
            Update Performance Coach Log
          </Button>
        }
      />

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 items-end">
          <StudentSearch label="Student" value={studentFilterId} onChange={(s) => setStudentFilterId(s?.id ?? null)} allowedIds={scopeToStudentIds ? new Set(scopeToStudentIds) : undefined} />
          {showCoordinatorFilter && (
            <SelectInput label="Performance Coach" placeholder="All performance coaches" value={teacherFilterId}
              onChange={(e) => setTeacherFilterId(e.target.value)}
              options={performanceCoaches.map((t) => ({ value: String(t.id), label: `${t.first_name} ${t.last_name ?? ""}`.trim() }))} />
          )}
          <SelectInput label="Type of Program" placeholder="All programs" value={courseTypeFilterId}
            onChange={(e) => setCourseTypeFilterId(e.target.value)}
            options={courseTypes.filter((c) => c.is_active).map((c) => ({ value: String(c.id), label: c.name }))} />
          <SelectInput label="Primary Goal" placeholder="All goals" value={primaryGoalFilterId}
            onChange={(e) => setPrimaryGoalFilterId(e.target.value)}
            options={primaryGoalOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
          <SelectInput label="Progress Status" placeholder="All statuses" value={progressStatusFilterId}
            onChange={(e) => setProgressStatusFilterId(e.target.value)}
            options={progressStatusOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
          <SelectInput label="Biggest Challenge" placeholder="All challenges" value={biggestChallengeFilterId}
            onChange={(e) => setBiggestChallengeFilterId(e.target.value)}
            options={biggestChallengeOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
          <SelectInput label="Next Action" placeholder="All actions" value={nextActionFilterId}
            onChange={(e) => setNextActionFilterId(e.target.value)}
            options={nextActionOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
          <SelectInput label="Renewal Status" placeholder="All statuses" value={renewalStatusFilterId}
            onChange={(e) => setRenewalStatusFilterId(e.target.value)}
            options={renewalStatusOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
          <SelectInput label="Referral Status" placeholder="All statuses" value={referralStatusFilterId}
            onChange={(e) => setReferralStatusFilterId(e.target.value)}
            options={referralStatusOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
          <SelectInput label="Relationship Owner" placeholder="All owners" value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            options={[{ value: "devi", label: "Devi" }, { value: "pc_cc", label: "PC/CC" }, { value: "ascend_now_system", label: "Ascend Now (System)" }]} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-navy-700">From date</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-navy-700">To date</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300" />
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <Button size="sm" variant="ghost" onClick={clearAll}>Clear all</Button>
        </div>
      </Card>

      <DataTable
        columns={columns}
        rows={logs}
        getRowId={(l) => l.id}
        loading={loading}
        onRowClick={(l) => navigate(detailPath(l.id))}
        emptyMessage="No Performance Coach logs found."
      />
    </>
  );
}
