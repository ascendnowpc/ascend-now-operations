import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../layout/PageHeader";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { TextInput, SelectInput } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { StudentSearch } from "../ui/StudentSearch";
import { StarRating } from "../ui/StarRating";
import { CoordinatorLogSubjectPicker, subjectRowLabel, subjectCategoryOf, baselineWithDate } from "./CoordinatorLogSubjectPicker";
import {
  fetchLatestCoordinatorLogForStudent, fetchSubjectGradeHistoryForStudent, useCoordinatorLogMutations,
  type CoordinatorLogSubjectInput, type CoordinatorLogInput, type SubjectGradeHistoryEntry,
} from "../../hooks/useCoordinatorLogs";
import { useCoordinatorLogOptions } from "../../hooks/useCoordinatorLogOptions";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups } from "../../hooks/useCurriculumGroups";
import { useTeachers } from "../../hooks/useTeachers";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { supabase } from "../../lib/supabaseClient";
import type { Subject, Teacher, PrimaryRelationshipOwner, CoordinatorLog, CoordinatorLogSubject } from "../../types/database";

const RELATIONSHIP_OWNER_OPTIONS: { value: PrimaryRelationshipOwner; label: string }[] = [
  { value: "devi", label: "Devi" },
  { value: "pc_cc", label: "PC/CC" },
  { value: "ascend_now_system", label: "Ascend Now (System)" },
];

// Course-type names whose selection reveals each subject block. "Beyond
// academics" (and therefore the Profile Building Project block) appears for
// Beyond Academic, Foundation Program and All-In-One; College Counselling
// subjects appear for College Counselling and All-In-One.
const PROFILE_BUILDING_PROGRAMS = ["Beyond Academic", "Foundation Program", "All-In-One"];
const COLLEGE_COUNSELLING_PROGRAMS = ["College Counselling", "All-In-One"];

function shortDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// The distinct earlier logs (with a grade for one of the given subjects), each
// becoming its own "current grade" column — ordered chronologically so the
// history reads left→right and simply extends as more logs are filed.
function gradeColumns(
  subjectKeys: string[],
  gradeHistory: Record<string, SubjectGradeHistoryEntry[]>,
  upToDate?: string,
): { log_id: number; log_date: string }[] {
  const seen = new Map<number, string>();
  for (const key of subjectKeys) {
    for (const e of gradeHistory[key] ?? []) {
      if (e.current_grade != null && (upToDate == null || e.log_date <= upToDate)) seen.set(e.log_id, e.log_date);
    }
  }
  return [...seen.entries()]
    .map(([log_id, log_date]) => ({ log_id, log_date }))
    .sort((a, b) => a.log_date.localeCompare(b.log_date) || a.log_id - b.log_id);
}

const subjectKey = (subjectId: number, curriculumId: number | null) => `${subjectId}:${curriculumId ?? ""}`;

// Month + year picker (no day) storing "YYYY-MM-01" — the browser-native
// month input, whose calendar lets you pick a year then a month.
function MonthYearPicker({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-navy-700">{label}</label>
      <input
        type="month"
        value={value ? value.slice(0, 7) : ""}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}-01` : null)}
        className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
      />
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 flex flex-col gap-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-navy-400">{title}</h2>
      {children}
    </Card>
  );
}

export function CoordinatorLogFormView({
  role,
  currentTeacher,
  currentTeacherLoading,
  currentTeacherError,
  allSubjects,
}: {
  role: "admin" | "teacher";
  currentTeacher?: Teacher | null;
  currentTeacherLoading?: boolean;
  currentTeacherError?: string | null;
  allSubjects: Subject[];
}) {
  const navigate = useNavigate();
  const { createCoordinatorLog } = useCoordinatorLogMutations();
  const { courseTypes } = useCourseTypes();
  const { curricula } = useCurricula();
  const { groups: allGroups } = useAllCurriculumGroups();
  const { teachers } = useTeachers();
  const { activeAssignments, getPcForStudent } = usePcAssignments();

  const { activeOptions: primaryGoalOptions } = useCoordinatorLogOptions("primary_goal");
  const { activeOptions: progressStatusOptions } = useCoordinatorLogOptions("progress_status");
  const { activeOptions: biggestChallengeOptions } = useCoordinatorLogOptions("biggest_challenge");
  const { activeOptions: nextActionOptions } = useCoordinatorLogOptions("next_action");
  const { activeOptions: referralStatusOptions } = useCoordinatorLogOptions("referral_status");

  const backListPath = role === "admin" ? "/admin/coordinator-logs" : "/teacher/coordinator-logs";
  const viewPath = (logId: string) => (role === "admin" ? `/admin/coordinator-logs/${logId}` : `/teacher/coordinator-logs/${logId}`);

  const activeCourseTypes = courseTypes.filter((c) => c.is_active);
  const activePcs = teachers.filter((t) => t.is_performance_coach && t.is_active);

  const assignedStudentIds = role === "teacher" && currentTeacher
    ? new Set(activeAssignments.filter((a) => a.pc_teacher_id === currentTeacher.id).map((a) => a.student_id))
    : undefined;

  // Owner is fixed to PC/CC for a Performance Coach; admins choose it.
  const defaultOwner: PrimaryRelationshipOwner | "" = role === "teacher" ? "pc_cc" : "";

  // Pre-selects the student when the form is opened from a student's detail tab
  // (…/coordinator-logs/new?student=S1).
  const [searchParams] = useSearchParams();
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(searchParams.get("student"));
  const [studentProgramIds, setStudentProgramIds] = useState<Set<number>>(new Set());
  const [gradeHistory, setGradeHistory] = useState<Record<string, SubjectGradeHistoryEntry[]>>({});
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [teacherId, setTeacherId] = useState("");
  const effectiveTeacherId = role === "admin" ? teacherId : (currentTeacher ? String(currentTeacher.id) : "");

  // Fixed to the student's actual programs — auto-derived from studentProgramIds
  // (their student_packages), never a coordinator choice.
  const courseTypeIds = [...studentProgramIds];
  const [subjects, setSubjects] = useState<CoordinatorLogSubjectInput[]>([]);

  const [primaryGoalOptionId, setPrimaryGoalOptionId] = useState("");
  const [idealOutcome, setIdealOutcome] = useState("");
  const [goalTimeline, setGoalTimeline] = useState<string | null>(null);
  const [progressStatusOptionId, setProgressStatusOptionId] = useState("");
  const [biggestChallengeOptionId, setBiggestChallengeOptionId] = useState("");
  const [nextActionOptionId, setNextActionOptionId] = useState("");

  const [finalOutcomeUniversityPlacement, setFinalOutcomeUniversityPlacement] = useState("");
  const [finalOutcomeProjectAchievement, setFinalOutcomeProjectAchievement] = useState("");
  const [evidenceLinkProfileBuilding, setEvidenceLinkProfileBuilding] = useState("");

  const [studentEngagementRating, setStudentEngagementRating] = useState<number | null>(null);
  const [parentEngagementRating, setParentEngagementRating] = useState<number | null>(null);
  const [academicProgressRating, setAcademicProgressRating] = useState<number | null>(null);
  const [referralPotentialRating, setReferralPotentialRating] = useState<number | null>(null);
  const [parentInvolvementRating, setParentInvolvementRating] = useState<number | null>(null);
  const [transformationOutcomesRating, setTransformationOutcomesRating] = useState<number | null>(null);
  const [loyaltyRetentionRating, setLoyaltyRetentionRating] = useState<number | null>(null);
  const [referralAdvocacyRating, setReferralAdvocacyRating] = useState<number | null>(null);
  const [parentBeliefRating, setParentBeliefRating] = useState<number | null>(null);

  // Renewal Status is NOT collected here — it's fully automatic and tracked
  // per-package (see coordinator_log_package_statuses), shown read-only in the
  // log & student views.
  const [referralStatusOptionId, setReferralStatusOptionId] = useState("");

  const [primaryRelationshipOwner, setPrimaryRelationshipOwner] = useState<PrimaryRelationshipOwner | "">(defaultOwner);

  const [prefilling, setPrefilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every field the log carries (keeping the chosen student + today's
  // date) — used when a student has no prior log, or is cleared.
  function resetForm() {
    setSubjects([]);
    setPrimaryGoalOptionId("");
    setIdealOutcome("");
    setGoalTimeline(null);
    setProgressStatusOptionId("");
    setBiggestChallengeOptionId("");
    setNextActionOptionId("");
    setFinalOutcomeUniversityPlacement("");
    setFinalOutcomeProjectAchievement("");
    setEvidenceLinkProfileBuilding("");
    setStudentEngagementRating(null);
    setParentEngagementRating(null);
    setAcademicProgressRating(null);
    setReferralPotentialRating(null);
    setParentInvolvementRating(null);
    setTransformationOutcomesRating(null);
    setLoyaltyRetentionRating(null);
    setReferralAdvocacyRating(null);
    setParentBeliefRating(null);
    setReferralStatusOptionId("");
    setPrimaryRelationshipOwner(defaultOwner);
  }

  // Prefill every field from the student's most recent log, so the PC edits
  // forward from it (log_date stays today; a save always writes a new row).
  function applyLog(data: CoordinatorLog & { subjects: CoordinatorLogSubject[] }) {
    // Type of program is NOT carried from the prior log — it's always derived
    // live from the student's current packages (see courseTypeIds above).
    // Carry the subject + baseline forward, but start the current grade blank —
    // the previous grades are shown as read-only history and the PC records a
    // fresh one for this check-in.
    setSubjects(data.subjects.map((s) => ({
      subject_id: s.subject_id, curriculum_id: s.curriculum_id,
      baseline_score: s.baseline_score, baseline_score_date: s.baseline_score_date,
      final_outcome_grade: null,
    })));
    setPrimaryGoalOptionId(data.primary_goal_option_id != null ? String(data.primary_goal_option_id) : "");
    setIdealOutcome(data.ideal_outcome ?? "");
    setGoalTimeline(data.goal_timeline);
    setProgressStatusOptionId(data.progress_status_option_id != null ? String(data.progress_status_option_id) : "");
    setBiggestChallengeOptionId(data.biggest_challenge_option_id != null ? String(data.biggest_challenge_option_id) : "");
    setNextActionOptionId(data.next_action_option_id != null ? String(data.next_action_option_id) : "");
    setFinalOutcomeUniversityPlacement(data.final_outcome_university_placement ?? "");
    setFinalOutcomeProjectAchievement(data.final_outcome_project_achievement ?? "");
    setEvidenceLinkProfileBuilding(data.evidence_link_profile_building ?? "");
    setStudentEngagementRating(data.student_engagement_rating);
    setParentEngagementRating(data.parent_engagement_rating);
    setAcademicProgressRating(data.academic_progress_rating);
    setReferralPotentialRating(data.referral_potential_rating);
    setParentInvolvementRating(data.parent_involvement_rating);
    setTransformationOutcomesRating(data.transformation_outcomes_rating);
    setLoyaltyRetentionRating(data.loyalty_retention_rating);
    setReferralAdvocacyRating(data.referral_advocacy_rating);
    setParentBeliefRating(data.parent_belief_rating);
    // Renewal Status is NOT carried from the prior log — it's recomputed live
    // and shown read-only by the effect below. Only Referral Status carries
    // forward.
    setReferralStatusOptionId(data.referral_status_option_id != null ? String(data.referral_status_option_id) : "");
    // A PC always owns their own logs; only admins keep the stored owner.
    setPrimaryRelationshipOwner(role === "teacher" ? "pc_cc" : (data.primary_relationship_owner ?? ""));
  }

  // On student select: load the programs they actually have a package in (this
  // fixes "Type of program", shown read-only below), and prefill every field
  // from their latest log (blank if none).
  useEffect(() => {
    if (!selectedStudentId) {
      setStudentProgramIds(new Set());
      setGradeHistory({});
      resetForm();
      return;
    }
    let cancelled = false;

    supabase
      .from("student_packages")
      .select("course_type_id, package_type_id")
      .eq("student_id", selectedStudentId)
      .then(({ data }) => {
        if (cancelled) return;
        // The program a student "has" is the bundle when the package belongs to
        // one (package_type_id → Foundation Program / All-In-One), otherwise the
        // standalone course type. A bundle's internal pool categories (an
        // All-In-One's Beyond Academic / College Counselling pools) are NOT
        // separate programs — that split only drives the subject blocks below.
        const ids = new Set<number>();
        for (const p of data ?? []) {
          if (p.package_type_id != null) ids.add(p.package_type_id as number);
          else if (p.course_type_id != null) ids.add(p.course_type_id as number);
        }
        setStudentProgramIds(ids);
      });

    // Per-subject current-grade history — shown beside the new-grade inputs.
    fetchSubjectGradeHistoryForStudent(selectedStudentId).then((m) => {
      if (!cancelled) setGradeHistory(m);
    });

    setPrefilling(true);
    fetchLatestCoordinatorLogForStudent(selectedStudentId).then(({ data }) => {
      if (cancelled) return;
      if (data) applyLog(data);
      else resetForm();
      setPrefilling(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudentId]);

  // Admin only: auto-fill the Coordinator from the student's currently-assigned
  // PC when a student is picked.
  useEffect(() => {
    if (role !== "admin" || !selectedStudentId) return;
    const pcId = getPcForStudent(selectedStudentId);
    if (pcId) setTeacherId(String(pcId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudentId]);

  // The programs the student actually has a package in (course type + bundle) —
  // shown read-only; the coordinator can no longer pick a subset.
  const studentPrograms = activeCourseTypes.filter((c) => studentProgramIds.has(c.id));
  const selectedNames = new Set(studentPrograms.map((c) => c.name));
  const showAcademic = selectedNames.has("Academic");
  const showProfileBuilding = PROFILE_BUILDING_PROGRAMS.some((n) => selectedNames.has(n));
  const showCollegeCounselling = COLLEGE_COUNSELLING_PROGRAMS.some((n) => selectedNames.has(n));

  const academicSubjects = subjects.filter((s) => subjectCategoryOf(s.subject_id, allSubjects) === "academic");
  // One column per earlier log that recorded a grade for any of these subjects.
  const gradeCols = gradeColumns(academicSubjects.map((s) => subjectKey(s.subject_id, s.curriculum_id)), gradeHistory);

  function updateFinalOutcome(subjectId: number, curriculumId: number | null, grade: string) {
    setSubjects((prev) => prev.map((s) =>
      s.subject_id === subjectId && s.curriculum_id === curriculumId ? { ...s, final_outcome_grade: grade.trim() || null } : s));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedStudentId) { setError("Select a student."); return; }
    if (!effectiveTeacherId) { setError(role === "admin" ? "Select a performance coach." : "Missing profile — please refresh."); return; }
    if (courseTypeIds.length === 0) { setError("This student has no active program packages — nothing to log."); return; }

    const input: CoordinatorLogInput = {
      student_id: selectedStudentId,
      teacher_id: effectiveTeacherId,
      log_date: logDate,
      course_type_ids: courseTypeIds,
      primary_goal_option_id: primaryGoalOptionId ? Number(primaryGoalOptionId) : null,
      goal_timeline: goalTimeline,
      progress_status_option_id: progressStatusOptionId ? Number(progressStatusOptionId) : null,
      biggest_challenge_option_id: biggestChallengeOptionId ? Number(biggestChallengeOptionId) : null,
      next_action_option_id: nextActionOptionId ? Number(nextActionOptionId) : null,
      final_outcome_university_placement: finalOutcomeUniversityPlacement.trim() || null,
      final_outcome_project_achievement: finalOutcomeProjectAchievement.trim() || null,
      evidence_link_profile_building: evidenceLinkProfileBuilding.trim() || null,
      student_engagement_rating: studentEngagementRating,
      parent_engagement_rating: parentEngagementRating,
      academic_progress_rating: academicProgressRating,
      referral_potential_rating: referralPotentialRating,
      // Renewal is automatic & per-package now — never set from the form.
      renewal_status_option_id: null,
      referral_status_option_id: referralStatusOptionId ? Number(referralStatusOptionId) : null,
      ideal_outcome: idealOutcome.trim() || null,
      parent_involvement_rating: parentInvolvementRating,
      transformation_outcomes_rating: transformationOutcomesRating,
      loyalty_retention_rating: loyaltyRetentionRating,
      referral_advocacy_rating: referralAdvocacyRating,
      parent_belief_rating: parentBeliefRating,
      primary_relationship_owner: primaryRelationshipOwner || null,
    };

    setSaving(true);
    const result = await createCoordinatorLog(input, subjects);
    setSaving(false);
    if (result.error || !result.data) { setError(result.error ?? "Something went wrong."); return; }
    navigate(viewPath(String(result.data.id)));
  }

  if (role === "teacher" && currentTeacherLoading) {
    return <div className="flex items-center gap-2 text-navy-300"><Spinner /> Loading…</div>;
  }
  if (role === "teacher" && currentTeacherError) {
    return <p className="text-red-600">{currentTeacherError}</p>;
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Update Performance Coach Log" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

        <SectionCard title="Student & Program">
          <StudentSearch
            value={selectedStudentId}
            onChange={(s) => setSelectedStudentId(s?.id ?? null)}
            allowedIds={assignedStudentIds}
            emptyAllowedMessage="You have no assigned students yet."
            required
          />
          {selectedStudentId && prefilling && (
            <p className="flex items-center gap-2 text-xs text-navy-400"><Spinner /> Prefilling from this student's latest log…</p>
          )}
          {role === "admin" && (
            <SelectInput
              label="Performance Coach"
              placeholder="Select performance coach…"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              options={activePcs.map((t) => ({ value: String(t.id), label: `${t.first_name} ${t.last_name ?? ""}`.trim() }))}
              required
            />
          )}
          <TextInput label="Log date" type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} required />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-navy-700">Type of program</label>
            <div className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-500 bg-navy-50">
              {!selectedStudentId
                ? "Select a student first…"
                : studentPrograms.length === 0
                  ? "This student has no packages yet"
                  : studentPrograms.map((c) => c.name).join(", ")}
            </div>
            <p className="text-xs text-navy-400">Fixed to this student's enrolled program(s) — not editable here. Drives which subject blocks appear below.</p>
          </div>

          {role === "teacher" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-navy-700">Primary Relationship Owner</label>
              <div className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-500 bg-navy-50">PC/CC</div>
            </div>
          ) : (
            <SelectInput label="Primary Relationship Owner" placeholder="Select…" value={primaryRelationshipOwner}
              onChange={(e) => setPrimaryRelationshipOwner(e.target.value as PrimaryRelationshipOwner)}
              options={RELATIONSHIP_OWNER_OPTIONS} />
          )}
        </SectionCard>

        <SectionCard title="Subjects & Profile Building">
          <CoordinatorLogSubjectPicker
            allSubjects={allSubjects}
            curricula={curricula}
            allGroups={allGroups}
            showAcademic={showAcademic}
            showProfileBuilding={showProfileBuilding}
            showCollegeCounselling={showCollegeCounselling}
            value={subjects}
            onChange={setSubjects}
          />
        </SectionCard>

        <SectionCard title="Goals & Progress">
          <SelectInput label="Primary Goal" placeholder="Select…" value={primaryGoalOptionId}
            onChange={(e) => setPrimaryGoalOptionId(e.target.value)}
            options={primaryGoalOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
          <TextInput label="Ideal Outcome" value={idealOutcome} onChange={(e) => setIdealOutcome(e.target.value)} />
          <MonthYearPicker label="Goal Timeline" value={goalTimeline} onChange={setGoalTimeline} />
          <SelectInput label="Progress Status" placeholder="Select…" value={progressStatusOptionId}
            onChange={(e) => setProgressStatusOptionId(e.target.value)}
            options={progressStatusOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
          <SelectInput label="Biggest Challenge" placeholder="Select…" value={biggestChallengeOptionId}
            onChange={(e) => setBiggestChallengeOptionId(e.target.value)}
            options={biggestChallengeOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
          <SelectInput label="Next Action" placeholder="Select…" value={nextActionOptionId}
            onChange={(e) => setNextActionOptionId(e.target.value)}
            options={nextActionOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
        </SectionCard>

        <SectionCard title="Final Outcomes">
          <TextInput label="Final Outcome - University Placement" value={finalOutcomeUniversityPlacement} onChange={(e) => setFinalOutcomeUniversityPlacement(e.target.value)} />
          <TextInput label="Final Outcome - Project Achievement" value={finalOutcomeProjectAchievement} onChange={(e) => setFinalOutcomeProjectAchievement(e.target.value)} />
          <TextInput label="Evidence Link for Profile Building" value={evidenceLinkProfileBuilding} onChange={(e) => setEvidenceLinkProfileBuilding(e.target.value)} />
          {academicSubjects.length > 0 && (
            <div>
              <label className="text-sm font-medium text-navy-700">Current Grades</label>
              <p className="text-xs text-navy-400 mt-0.5">Each earlier log is its own column; record this check-in's grade in the last column.</p>
              <div className="overflow-x-auto rounded-xl border border-navy-100 mt-1.5">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-navy-50 text-left text-xs font-semibold text-navy-500 uppercase tracking-wide">
                      <th className="px-4 py-2">Subject</th>
                      <th className="px-4 py-2 whitespace-nowrap">Baseline</th>
                      {gradeCols.map((c) => (
                        <th key={c.log_id} className="px-4 py-2 whitespace-nowrap">{shortDate(c.log_date)}</th>
                      ))}
                      <th className="px-4 py-2 whitespace-nowrap">New Current Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {academicSubjects.map((s, i) => {
                      const hist = gradeHistory[subjectKey(s.subject_id, s.curriculum_id)] ?? [];
                      return (
                        <tr key={i} className="border-t border-navy-50">
                          <td className="px-4 py-2 font-medium text-navy-700">{subjectRowLabel(s.subject_id, s.curriculum_id, allSubjects, curricula, allGroups)}</td>
                          <td className="px-4 py-2 text-navy-600 whitespace-nowrap">{baselineWithDate(s.baseline_score, s.baseline_score_date)}</td>
                          {gradeCols.map((c) => (
                            <td key={c.log_id} className="px-4 py-2 text-navy-600 whitespace-nowrap">{hist.find((e) => e.log_id === c.log_id)?.current_grade ?? "—"}</td>
                          ))}
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={s.final_outcome_grade ?? ""}
                              onChange={(e) => updateFinalOutcome(s.subject_id, s.curriculum_id, e.target.value)}
                              placeholder="e.g. B, 82%, IB 6"
                              className="w-40 rounded-lg border border-navy-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Ratings">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StarRating label="Student Engagement" value={studentEngagementRating} onChange={setStudentEngagementRating} />
            <StarRating label="Parent Engagement" value={parentEngagementRating} onChange={setParentEngagementRating} />
            <StarRating label="Academic Progress" value={academicProgressRating} onChange={setAcademicProgressRating} />
            <StarRating label="Referral Potential" value={referralPotentialRating} onChange={setReferralPotentialRating} />
            <StarRating label="Engagement" helperText="How involved are the parents?" value={parentInvolvementRating} onChange={setParentInvolvementRating} />
            <StarRating label="Transformation / Outcomes" helperText="Did the student actually grow?" value={transformationOutcomesRating} onChange={setTransformationOutcomesRating} />
            <StarRating label="Loyalty / Retention" helperText="How committed are they?" value={loyaltyRetentionRating} onChange={setLoyaltyRetentionRating} />
            <StarRating label="Referral / Advocacy" helperText={"5 = Referred 2+ families OR actively promotes you\n3 = Referred once / positive word of mouth\n1 = No referrals"} value={referralAdvocacyRating} onChange={setReferralAdvocacyRating} />
            <StarRating label="Parent Belief Score" helperText={"How strongly does this parent believe in Ascend Now?\n5 = Fully trusts, advocates, defends you\n3 = Sees value but still evaluating\n1 = Skeptical / unclear"} value={parentBeliefRating} onChange={setParentBeliefRating} />
          </div>
        </SectionCard>

        <SectionCard title="Referral">
          <p className="text-xs text-navy-400 -mt-1">Renewal is tracked automatically per package — shown in the log &amp; on the student's Coordinator Log tab, not entered here.</p>
          <SelectInput label="Referral Status" placeholder="Select…" value={referralStatusOptionId}
            onChange={(e) => setReferralStatusOptionId(e.target.value)}
            options={referralStatusOptions.map((o) => ({ value: String(o.id), label: o.label }))} />
        </SectionCard>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving || prefilling}>{saving ? "Saving…" : "Update Performance Coach Log"}</Button>
          <Button type="button" variant="ghost" onClick={() => navigate(backListPath)} disabled={saving}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
