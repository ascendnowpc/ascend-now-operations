import { useRef, useState, useEffect, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Packer } from "docx";
import { buildSummaryDoc } from "../../utils/buildSummaryDoc";
import { PageHeader } from "../layout/PageHeader";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { TextInput, SelectInput } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { StudentSearch } from "../ui/StudentSearch";
import { BeyondAcademicSubjectSelect, type BeyondAcademicOption } from "../ui/BeyondAcademicSubjectSelect";
import { SubjectLevelSelect } from "../ui/SubjectLevelSelect";
import { uploadSubjectNoteFile } from "../../utils/subjectNoteFile";
import { fetchSessionLogById, useSessionLogs } from "../../hooks/useSessionLogs";
import { useMonthlyReports, isDateInLockedMonth } from "../../hooks/useMonthlyReports";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { useCcAssignments } from "../../hooks/useCcAssignments";
import { loggableStudentIds } from "../../utils/ccAssignment";
import { coordinatorFieldState, derivedCoordinatorId } from "../../utils/sessionCoordinator";
import { useProgramTypes } from "../../hooks/useProgramTypes";
import { useSessionDurationSettings } from "../../hooks/useSessionDurationSettings";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useTeachers, useTeacherSubjects } from "../../hooks/useTeachers";
import { useCurricula } from "../../hooks/useCurricula";
import { useAllCurriculumGroups, subjectDisplayLabel } from "../../hooks/useCurriculumGroups";
import { useStudents } from "../../hooks/useStudents";
import { supabase } from "../../lib/supabaseClient";
import type { NoShowType, IndependentWorkOption, EngagementRating, Student, SessionLog, Subject, Teacher } from "../../types/database";

const DURATION_OPTIONS = [
  { value: "0.25", label: "0.25 hrs (15 min)" },
  { value: "0.5", label: "0.5 hrs (30 min)" },
  { value: "0.75", label: "0.75 hrs (45 min)" },
  { value: "1", label: "1 hr" },
  { value: "1.25", label: "1.25 hrs" },
  { value: "1.5", label: "1.5 hrs" },
  { value: "1.75", label: "1.75 hrs" },
  { value: "2", label: "2 hrs" },
];

const NO_SHOW_LABELS: Record<NoShowType, string> = {
  no_show_1: "No Show 1",
  no_show_2: "No Show 2",
  no_show_plus: "No Show +",
};

const FATHOM_SHARE_RE = /^https:\/\/fathom\.video\/share\/[a-zA-Z0-9_-]+$/;

const INDEPENDENT_WORK_OPTIONS: { value: IndependentWorkOption; label: string }[] = [
  { value: "homework", label: "Homework" },
  { value: "revision", label: "Revision" },
  { value: "self_practice", label: "Self Practice" },
  { value: "independent_studies", label: "Independent Studies" },
  { value: "none", label: "None of the above" },
];

const FLAG_CATEGORIES = [
  "Academic Performance Concern",
  "Behavioural / Mental Health Issue",
  "Attendance / Engagement Issue",
  "Parent Communication Required",
  "Urgent Follow-up Needed",
  "Other",
];

const TYPE_DISPLAY_ORDER: Record<string, number> = {
  academic: 0,
  beyond_academic: 1,
  college_counselling: 2,
  demo_lesson: 3,
  ascend_offline_work: 4,
  student_offline_work: 5,
};

// course_type_id is billing-only and independent of program_types. Program
// type *names* can drift from course type names (e.g. renames), so match by
// the stable `type` field first and only fall back to name equality.
const PROGRAM_TYPE_TO_COURSE_TYPE_NAME: Record<string, string> = {
  academic: "Academic",
  beyond_academic: "Beyond Academic",
  college_counselling: "College Counselling",
};

async function uploadSummaryDocx(
  summary: string,
  studentId: string,
  sessionDate: string,
  videoLink: string,
): Promise<{ url: string | null; error: string | null }> {
  const doc = buildSummaryDoc(summary, studentId, sessionDate, videoLink || undefined);

  const blob = await Packer.toBlob(doc);
  const fileName = `${studentId}_${sessionDate}_${Date.now()}.docx`;

  const { error } = await supabase.storage
    .from("session-summaries")
    .upload(fileName, blob, { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", upsert: false });

  if (error) return { url: null, error: error.message };

  const { data } = supabase.storage.from("session-summaries").getPublicUrl(fileName);
  return { url: data.publicUrl, error: null };
}

/**
 * Shared session-log add/edit form used by BOTH admin
 * (`AdminSessionLogFormPage.tsx`) and teacher/coach
 * (`TeacherSessionFormPage.tsx`) — the last and largest piece of the
 * admin/teacher session-log duplication (the LIST and DETAIL/view pages were
 * already unified into `SessionLogsListView.tsx`/`SessionLogDetailView.tsx`).
 * Both pages shared ~95% identical program-type cascade, subject-picker,
 * no-show handling, teacher-feedback section, and submit/payload logic —
 * only differing in: whether "Teacher" is a free-choice dropdown (admin) or
 * fixed to the logged-in identity (teacher/coach, via `currentTeacher`);
 * whether the student search is restricted to a coach's own assigned
 * students (`allowedIds`); an edit-permission gate (only a coach may edit an
 * existing session — a plain teacher may not, admin always may); and a
 * handful of copy/layout differences (page title, card width, coordinator
 * placeholder, cancel/locked-record back paths) driven by `role`.
 */
export function SessionLogFormView({
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
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const { createSessionLog, updateSessionLog } = useSessionLogs();
  const { fetchLockedMonths } = useMonthlyReports();
  const { programTypes } = useProgramTypes();
  const { settings: durationSettings } = useSessionDurationSettings();
  const { teachers } = useTeachers();
  const { curricula } = useCurricula();
  const { students } = useStudents();
  const { groups: allGroups } = useAllCurriculumGroups();
  const { courseTypes } = useCourseTypes();
  const { activeAssignments, getPcForStudent } = usePcAssignments();
  const { activeAssignments: activeCcAssignments } = useCcAssignments();

  const isCoach = role === "teacher" && currentTeacher?.is_performance_coach === true;
  const isCounsellor = role === "teacher" && currentTeacher?.is_college_counselor === true;
  const backListPath = role === "admin" ? "/admin/session-logs" : "/teacher/sessions";
  const viewPath = (sessionId: string) => role === "admin" ? `/admin/session-logs/${sessionId}` : `/teacher/sessions/${sessionId}`;

  // PCs and CCs may only log/search students assigned to them; admin and
  // plain teachers can search/pick anyone. Rule lives in
  // src/utils/ccAssignment.ts so it's unit-testable (ccAssignment.test.ts).
  const assignedStudentIds = loggableStudentIds({
    isAdmin: role === "admin",
    teacherId: currentTeacher?.id ?? null,
    isCoach,
    isCounsellor,
    activePcAssignments: activeAssignments,
    activeCcAssignments,
  });

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().slice(0, 10));
  // Typed in directly for a regular session (see the "Session duration"
  // dropdown below). Only No Show + doesn't ask at all — it's set from the
  // admin-wide default (session_duration_settings) the moment that no-show
  // type is picked, in handleNoShowSelect below.
  const [duration, setDuration] = useState("0.5");

  // Program type — primary selector (string ids)
  const [topLevelProgramTypeId, setTopLevelProgramTypeId] = useState("");
  const [subTypeId, setSubTypeId] = useState("");
  const [teacherCurriculumId, setTeacherCurriculumId] = useState(""); // "" = not selected, "null" = Other, "123" = curriculum id
  const [teacherGroupId, setTeacherGroupId] = useState<number | null>(null);
  const [teacherSubjectId, setTeacherSubjectId] = useState("");

  const [topic, setTopic] = useState("");
  const [videoLink, setVideoLink] = useState("");
  const [videoLinkError, setVideoLinkError] = useState<string | null>(null);
  const [fathomSummary, setFathomSummary] = useState("");
  const [workForAscendSpec, setWorkForAscendSpec] = useState("");
  // Optional subject note filed straight from this form — saved to
  // subject_notes as part of "Log session" (no separate button), never stored
  // on or shown with the session log itself. Only saved when there's real
  // content (a body or a file); the name is optional.
  const [noteName, setNoteName] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteFile, setNoteFile] = useState<File | null>(null);
  // Admin-only: which teacher is logging this session for — a teacher/coach
  // logging their own session has no picker, it's always their own id.
  const [teacherId, setTeacherId] = useState("");
  const effectiveTeacherId = role === "admin" ? teacherId : (currentTeacher ? String(currentTeacher.id) : "");
  const [coordinatorId, setCoordinatorId] = useState("");
  const { subjects: myTeacherSubjects } = useTeacherSubjects(effectiveTeacherId || undefined);
  const [noShowType, setNoShowType] = useState<NoShowType | null>(null);
  const [showNoShowMenu, setShowNoShowMenu] = useState(false);
  const noShowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNoShowMenu) return;
    function handleOutside(e: MouseEvent) {
      if (noShowRef.current && !noShowRef.current.contains(e.target as Node)) {
        setShowNoShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showNoShowMenu]);

  const [independentWork, setIndependentWork] = useState<IndependentWorkOption | "">("");
  const [engagementRating, setEngagementRating] = useState<EngagementRating | "">("");
  const [performanceFeedback, setPerformanceFeedback] = useState("");
  const [flagForCoach, setFlagForCoach] = useState(false);
  const [flagCategory, setFlagCategory] = useState("");
  const [flagComments, setFlagComments] = useState("");

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lockedMonths, setLockedMonths] = useState<Set<string>>(new Set());
  const [originalSessionDate, setOriginalSessionDate] = useState<string | null>(null);
  const [loadedRecord, setLoadedRecord] = useState<SessionLog | null>(null);
  const restoredSubjectRef = useRef(false);

  useEffect(() => {
    fetchLockedMonths().then(({ data }) => setLockedMonths(data));
  }, [fetchLockedMonths]);

  // A record already sitting in a locked month is frozen outright — the
  // check is against the date it was loaded with, not whatever the user
  // might type into the date field next.
  const recordIsLocked = isEditing && originalSessionDate !== null && isDateInLockedMonth(originalSessionDate, lockedMonths);
  // A new entry, or an edit that moves the date, into a locked month is
  // blocked the same way (mirrors the DB trigger — see migration
  // 20260702010000_lock_session_logs_for_locked_months.sql).
  const targetMonthLocked = isDateInLockedMonth(sessionDate, lockedMonths);
  const lockedMonthLabel = targetMonthLocked
    ? new Date(sessionDate).toLocaleString("en-GB", { month: "long", year: "numeric" })
    : null;

  // No Show + is the one no-show type that still deducts from the student's
  // package (see utils/noShow.ts) — it needs a course_type_id to know which
  // package, same as a real session. No Show 1/2 never touch a package, so
  // course_type_id/session_duration_hrs stay null for them, even though
  // program type/subject are now captured for every no-show type.
  const isNoShowPlus = noShowType === "no_show_plus";

  // Derive program type hierarchy
  const topLevelTypes = programTypes
    .filter((p) => p.parent_id === null && p.is_active)
    .filter((p) => !isNoShowPlus || p.type === "academic" || p.type === "beyond_academic")
    .sort((a, b) => {
      const ao = TYPE_DISPLAY_ORDER[a.type ?? ""] ?? 99;
      const bo = TYPE_DISPLAY_ORDER[b.type ?? ""] ?? 99;
      return ao !== bo ? ao - bo : a.name.localeCompare(b.name);
    });

  const selectedTopLevelType = programTypes.find((p) => String(p.id) === topLevelProgramTypeId) ?? null;

  const groupSubTypes = selectedTopLevelType
    ? programTypes.filter((p) => p.parent_id === selectedTopLevelType.id && p.is_active)
    : [];

  const hasSubTypes = groupSubTypes.length > 0;
  const selectedSubType = groupSubTypes.find((p) => String(p.id) === subTypeId) ?? null;

  const isAcademic = selectedTopLevelType?.type === "academic";
  const isBeyondAcademic = selectedTopLevelType?.type === "beyond_academic";
  const isCollegeCounselling = selectedTopLevelType?.type === "college_counselling";
  const isDemoLesson = selectedTopLevelType?.type === "demo_lesson";
  const isWorkForAscendType = selectedTopLevelType?.type === "work_for_ascend_now";
  // Ascend Offline Work is its own standalone top-level type (no
  // sub-program step); Student Offline Work is a top-level group with two
  // sub-programs (Academic / Beyond Academic) that need a student and
  // deduct hours from that student's package.
  const isAscendOfflineWork = selectedTopLevelType?.type === "ascend_offline_work";
  const isStudentOfflineWork = selectedTopLevelType?.type === "student_offline_work";
  const isOfflineWork = isAscendOfflineWork || isStudentOfflineWork;
  const isAcademicOfflineWork = selectedSubType?.type === "academic_offline_work";
  const isBeyondAcademicOfflineWork = selectedSubType?.type === "beyond_academic_offline_work";
  // Work for Ascend Now sessions and Ascend Offline Work don't involve a student.
  const studentInvolved = !isWorkForAscendType && !isAscendOfflineWork;

  const coaches = teachers.filter((t) => t.is_performance_coach && t.is_active);
  // The coach on a session that involves a student is derived, never chosen —
  // it's whoever that student is assigned to. Only the student-less program
  // types (Work for Ascend Now; Ascend Offline Work, which reuses this field
  // as "Assigned by") still get a picker, since there's no assignment to read
  // it from. Rules in src/utils/sessionCoordinator.ts (unit-tested).
  const assignedPcId = selectedStudent ? getPcForStudent(selectedStudent.id) : null;
  // A demo lesson may be logged against a typed-in name for someone not in the
  // database yet, who therefore has no coach to derive — that case gets the
  // full coach list instead.
  const coordinatorOpts = {
    studentInvolved,
    selectedStudentId: selectedStudent?.id ?? null,
    assignedPcId,
    studentRecordOptional: isDemoLesson,
  };
  const coordinatorField = coordinatorFieldState(coordinatorOpts);
  const coordinatorName = (teacherId: string) => {
    const t = teachers.find((x) => x.id === teacherId);
    return t ? `${t.first_name} ${t.last_name ?? ""}`.trim() : teacherId;
  };

  // Academic teacher subjects (for curriculum-first flow) — scoped to the
  // Teacher picked above, mirroring how a teacher sees their own subjects
  // when logging their own session.
  const academicTeacherSubs = myTeacherSubjects.filter((ts) => {
    const subj = allSubjects.find((s) => s.id === ts.subject_id);
    return subj?.category === "academic";
  });

  // Curriculum options derived from the selected teacher's own academic subjects
  const teacherAcademicCurriculumIds = [...new Set(academicTeacherSubs.map((ts) => ts.curriculum_id))];
  const teacherCurriculumOptions = [
    ...curricula
      .filter((c) => teacherAcademicCurriculumIds.includes(c.id))
      .map((c) => ({ value: String(c.id), label: c.name })),
    ...(teacherAcademicCurriculumIds.includes(null) ? [{ value: "null", label: "Other" }] : []),
  ];

  // Groups available for the selected curriculum (active only)
  const curriculumGroups = teacherCurriculumId && teacherCurriculumId !== "null"
    ? allGroups.filter((g) => g.curriculum_id === Number(teacherCurriculumId) && g.is_active)
    : [];
  const hasGroups = curriculumGroups.length > 0;
  // A real curriculum (not the "Other" bucket) with no groups at all — e.g.
  // ACT/SAT/TOEFL/IELTS, single standardized exams with no group breakdown.
  // These act as standalone: no group step, and no subject step either
  // unless the teacher genuinely has more than one subject under it.
  const isUngroupedCurriculum = Boolean(teacherCurriculumId) && teacherCurriculumId !== "null" && !hasGroups;

  // Only show groups that the teacher actually has subjects in
  const teacherGroupIds = new Set(
    academicTeacherSubs
      .filter((ts) => ts.curriculum_id === Number(teacherCurriculumId))
      .map((ts) => allSubjects.find((s) => s.id === ts.subject_id)?.curriculum_group_id)
      .filter((id): id is number => id != null)
  );
  const availableGroups = curriculumGroups.filter((g) => teacherGroupIds.has(g.id));

  // Academic subjects filtered by curriculum, then by group when applicable
  const filteredAcademicSubs = isAcademic && teacherCurriculumId
    ? academicTeacherSubs.filter((ts) => {
        const inCurriculum = teacherCurriculumId === "null"
          ? ts.curriculum_id === null
          : ts.curriculum_id === Number(teacherCurriculumId);
        if (!inCurriculum) return false;
        // "null" curriculum (Other) has no groups; show those subjects flat
        if (teacherCurriculumId === "null") return true;
        const subj = allSubjects.find((s) => s.id === ts.subject_id);
        return subj?.curriculum_group_id === teacherGroupId;
      })
    : [];

  // The Subject → Level two-step picker works in terms of Subject records,
  // not teacher_subjects rows — a teacher_subjects row is 1:1 with a subject
  // within a given curriculum, so this is a safe lookup.
  const filteredAcademicSubjects: Subject[] = filteredAcademicSubs
    .map((ts) => allSubjects.find((s) => s.id === ts.subject_id))
    .filter((s): s is Subject => s != null);

  // Ungrouped curricula (ACT/SAT/TOEFL/IELTS) are standalone — no group step
  // — but the teacher still has to explicitly pick the subject themselves
  // even when there's only one option, rather than it being auto-logged.

  // Beyond-academic subjects sit directly under Beyond Academics — one flat
  // list, no separate "Section" dropdown to click through first. College
  // Counselling subjects (category = 'college_counselling') are excluded
  // here even though they also aren't 'academic' — they get their own flat
  // picker below.
  const allBeyondAcademicSubs = myTeacherSubjects.filter((ts) => {
    const subj = allSubjects.find((s) => s.id === ts.subject_id);
    return subj?.category !== "academic" && subj?.category !== "college_counselling";
  });
  const beyondAcademicOptions: BeyondAcademicOption[] = allBeyondAcademicSubs.map((ts) => {
    return {
      value: String(ts.id),
      label: getTeacherSubjectLabel(ts.subject_id),
    };
  });

  // College Counselling subjects (College Counselling, College Essays) sit
  // directly under it — same flat, no-grouping picker as Beyond Academics.
  const allCollegeCounsellingSubs = myTeacherSubjects.filter((ts) => {
    const subj = allSubjects.find((s) => s.id === ts.subject_id);
    return subj?.category === "college_counselling";
  });
  const collegeCounsellingOptions: BeyondAcademicOption[] = allCollegeCounsellingSubs.map((ts) => {
    return {
      value: String(ts.id),
      label: getTeacherSubjectLabel(ts.subject_id),
    };
  });

  const showSubjectPicker = (isAcademic || isBeyondAcademic || isCollegeCounselling) && studentInvolved;

  function getTeacherSubjectLabel(subjectId: number): string {
    const s = allSubjects.find((x) => x.id === subjectId);
    if (!s) return `#${subjectId}`;
    return subjectDisplayLabel(s.name, s.board, s.subject_code, s.level);
  }

  const selectedTS = myTeacherSubjects.find((ts) => String(ts.id) === teacherSubjectId);

  // The value that actually gets stored as program_type_id (drives the subject-picker UI)
  const effectiveProgramTypeId = hasSubTypes ? subTypeId : topLevelProgramTypeId;

  // Academic/Beyond Academic Offline Work bill against the same course type
  // as their regular counterparts (so hours still deduct from the right
  // package); Ascend Offline Work bills against nothing.
  const selectedCourseType = isAscendOfflineWork
    ? null
    : isAcademicOfflineWork
      ? courseTypes.find((ct) => ct.name === "Academic") ?? null
      : isBeyondAcademicOfflineWork
        ? courseTypes.find((ct) => ct.name === "Beyond Academic") ?? null
        : selectedTopLevelType
          ? courseTypes.find((ct) =>
              ct.name === (selectedTopLevelType.type ? PROGRAM_TYPE_TO_COURSE_TYPE_NAME[selectedTopLevelType.type] : undefined) ||
              ct.name === selectedTopLevelType.name
            ) ?? null
          : null;

  const selectedSubjectName = selectedTS ? allSubjects.find((s) => s.id === selectedTS.subject_id)?.name ?? "" : "";
  const isWorkForAscend = isWorkForAscendType || selectedSubjectName.toLowerCase() === "work for ascend now";

  const [customStudentName, setCustomStudentName] = useState("");

  function handleTopLevelTypeChange(id: string) {
    setTopLevelProgramTypeId(id);
    setSubTypeId("");
    setTeacherCurriculumId("");
    setTeacherGroupId(null);
    setTeacherSubjectId("");
    setWorkForAscendSpec("");
    setSelectedStudent(null);
    setCustomStudentName("");
    // Ascend Offline Work repurposes this field as "Assigned by" with a
    // different option set (every teacher, not just coaches) — reset on any
    // type change so a stale selection from one meaning can't leak into the
    // other.
    setCoordinatorId("");
  }

  function handleTeacherChange(val: string) {
    setTeacherId(val);
    setTeacherCurriculumId("");
    setTeacherGroupId(null);
    setTeacherSubjectId("");
  }

  function handleSubjectChange(val: string) {
    setTeacherSubjectId(val);
    setWorkForAscendSpec("");
  }

  // SubjectLevelSelect works in terms of a subject id, not a teacher_subjects
  // id — resolve back to the matching teacher_subjects row within the
  // currently selected curriculum before storing it.
  function handleAcademicSubjectLevelChange(subjectIdStr: string) {
    const match = subjectIdStr
      ? filteredAcademicSubs.find((ts) => String(ts.subject_id) === subjectIdStr)
      : undefined;
    setTeacherSubjectId(match ? String(match.id) : "");
    setWorkForAscendSpec("");
  }

  function handleVideoLinkChange(val: string) {
    setVideoLink(val);
    if (val && !FATHOM_SHARE_RE.test(val)) {
      setVideoLinkError("Only shareable Fathom links are accepted (https://fathom.video/share/…)");
    } else {
      setVideoLinkError(null);
    }
  }

  function handleNoShowSelect(type: NoShowType) {
    setNoShowType(type);
    setShowNoShowMenu(false);
    // No Show + is the only no-show type that bills (see isNoShowPlus
    // below), so it's the only one whose duration matters — set from the
    // admin-wide default rather than asking, unlike a regular session's
    // duration (typed in via the dropdown below). No Show 1/2 never store a
    // duration at all (gated to null in the payload), so this is inert
    // for them.
    setDuration(type === "no_show_plus" ? String(durationSettings?.default_duration_hrs ?? 1) : "0.5");
    // Every no-show type keeps whatever program type/subject was already
    // selected — a no-show still happened for a specific subject, exactly
    // like a regular session (see NO_SHOW_LABELS usage below and
    // utils/noShow.ts for what stays non-billable). The one exception: No
    // Show + only bills against Academic/Beyond Academic course types, so a
    // program type outside those two is no longer valid once + is picked.
    if (
      type === "no_show_plus" &&
      selectedTopLevelType &&
      selectedTopLevelType.type !== "academic" &&
      selectedTopLevelType.type !== "beyond_academic"
    ) {
      setTopLevelProgramTypeId("");
      setSubTypeId("");
      setTeacherCurriculumId("");
      setTeacherGroupId(null);
      setTeacherSubjectId("");
    }
    setTopic("");
    setVideoLink("");
    setVideoLinkError(null);
    setFathomSummary("");
    setWorkForAscendSpec("");
  }

  function clearNoShow() {
    setNoShowType(null);
    setShowNoShowMenu(false);
  }

  // Keep the coach locked to the selected student's assignment. It FOLLOWS
  // the student rather than only filling a blank field: the old version bailed
  // out whenever something was already selected, so choosing a coordinator
  // before a student, or switching students afterwards, left the session filed
  // against a coach who wasn't the student's. Clearing to "" when there's no
  // student (or no assignment) is deliberate — a stale id from the previous
  // student must not survive the switch. `null` means the field is a picker,
  // so the value is the user's to set and must be left alone.
  const derivedCoordinator = derivedCoordinatorId(coordinatorOpts);
  useEffect(() => {
    if (derivedCoordinator === null) return;
    setCoordinatorId((prev) => (prev === derivedCoordinator ? prev : derivedCoordinator));
  }, [derivedCoordinator]);

  useEffect(() => {
    if (!isEditing || !id) return;
    if (role === "teacher" && !currentTeacher) return;
    fetchSessionLogById(Number(id)).then(({ data }) => {
      if (data) {
        setOriginalSessionDate(data.session_date);
        if (data.student_id) {
          const s = students.find((s) => s.id === data.student_id);
          if (s) setSelectedStudent(s);
        }
        setSessionDate(data.session_date);
        setDuration(data.session_duration_hrs ? String(data.session_duration_hrs) : "0.5");
        setLoadedRecord(data);
        setTopic(data.topic ?? "");
        setVideoLink(data.video_link ?? "");
        setFathomSummary(data.fathom_summary ?? "");
        if (role === "admin") setTeacherId(data.teacher_id ? String(data.teacher_id) : "");
        setCoordinatorId(data.coordinator_teacher_id ? String(data.coordinator_teacher_id) : "");
        setNoShowType(data.no_show_type ?? null);
        setIndependentWork((data.independent_work?.[0] as IndependentWorkOption) ?? "");
        setEngagementRating((data.engagement_rating as EngagementRating) ?? "");
        setPerformanceFeedback(data.performance_feedback ?? "");
        setFlagForCoach(data.flag_for_coach ?? false);
        setFlagCategory(data.flag_category ?? "");
        setFlagComments(data.flag_comments ?? "");

        // Restore program type selection
        if (data.program_type_id && programTypes.length > 0) {
          const storedPT = programTypes.find((p) => p.id === data.program_type_id);
          if (storedPT) {
            if (storedPT.parent_id === null) {
              setTopLevelProgramTypeId(String(storedPT.id));
            } else {
              const parentPT = programTypes.find((p) => p.id === storedPT.parent_id);
              if (parentPT) setTopLevelProgramTypeId(String(parentPT.id));
              setSubTypeId(String(storedPT.id));
            }
          }
        }

      }
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEditing, currentTeacher?.id, students.length, programTypes.length, allSubjects.length]);

  // Once the teacher's teacher_subjects are known, the exact (subject,
  // curriculum) pairing of a loaded record can be resolved back to a
  // teacher_subjects row for the Curriculum/Section/Subject dropdowns above.
  useEffect(() => {
    if (!loadedRecord || restoredSubjectRef.current) return;
    if (loadedRecord.subject_id == null) { restoredSubjectRef.current = true; return; }
    if (myTeacherSubjects.length === 0) return;
    const found = myTeacherSubjects.find(
      (ts) => ts.subject_id === loadedRecord.subject_id && ts.curriculum_id === loadedRecord.curriculum_id
    );
    if (found) {
      setTeacherSubjectId(String(found.id));
      const subj = allSubjects.find((s) => s.id === found.subject_id);
      if (subj?.category === "academic") {
        setTeacherCurriculumId(found.curriculum_id != null ? String(found.curriculum_id) : "null");
        setTeacherGroupId(subj.curriculum_group_id ?? null);
      }
    }
    restoredSubjectRef.current = true;
  }, [loadedRecord, myTeacherSubjects, allSubjects]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (role === "teacher" && !currentTeacher) return;
    if (targetMonthLocked) {
      setError(`${lockedMonthLabel} is a locked report month — session logs can't be added or moved into it.`);
      return;
    }
    if (noShowType && !selectedStudent) {
      setError("Please select a student.");
      return;
    }
    if (!noShowType && studentInvolved && !isDemoLesson && !selectedStudent) {
      setError("Please select a student.");
      return;
    }
    if (!noShowType && isDemoLesson && !selectedStudent && !customStudentName.trim()) {
      setError("Please select a student or enter a student name.");
      return;
    }
    if (videoLink && !FATHOM_SHARE_RE.test(videoLink)) {
      setError("Please enter a valid shareable Fathom link.");
      return;
    }
    if (flagForCoach && !flagComments.trim()) {
      setError("Additional comments are required when flagging for the Performance Coach.");
      return;
    }
    setSaving(true);
    setError(null);

    const effectiveTopic = isWorkForAscend && workForAscendSpec
      ? `${topic ? topic + " — " : ""}Work for Ascend Now: ${workForAscendSpec}`
      : topic || null;

    let summaryDocUrl: string | null = null;
    if (fathomSummary.trim() && !noShowType && !isOfflineWork) {
      const { url, error: uploadError } = await uploadSummaryDocx(
        fathomSummary.trim(),
        selectedStudent?.id ?? customStudentName.trim() ?? "unknown",
        sessionDate,
        videoLink.trim(),
      );
      if (uploadError) {
        setError(`Failed to upload summary: ${uploadError}`);
        setSaving(false);
        return;
      }
      summaryDocUrl = url;
    }

    const feedbackFields = studentInvolved
      ? {
          independent_work: !isDemoLesson && independentWork ? [independentWork] : null,
          engagement_rating: !isOfflineWork && engagementRating ? engagementRating : null,
          performance_feedback: performanceFeedback.trim() || null,
          flag_for_coach: flagForCoach,
          flag_category: flagForCoach && flagCategory ? flagCategory : null,
          flag_comments: flagForCoach && flagComments.trim() ? flagComments.trim() : null,
        }
      : {
          independent_work: null,
          engagement_rating: null,
          performance_feedback: null,
          flag_for_coach: false,
          flag_category: null,
          flag_comments: null,
        };

    const payloadTeacherId = role === "admin"
      ? (teacherId || null)
      : (currentTeacher ? currentTeacher.id : null);

    const payload = noShowType
      ? {
          student_id: selectedStudent!.id,
          student_first_name: selectedStudent!.first_name,
          student_last_name: selectedStudent!.last_name,
          session_date: sessionDate,
          // Program type/subject are kept for every no-show type, exactly
          // like a regular session, so there's a record of what the no-show
          // was for. Only course_type_id/session_duration_hrs stay gated to
          // No Show + — those are what the package-deduction trigger and
          // computeHoursUsed() (see useStudentPackages.ts / utils/noShow.ts)
          // actually key off, and No Show 1/2 must never bill.
          session_duration_hrs: isNoShowPlus ? Number(duration) : null,
          program_type_id: effectiveProgramTypeId ? Number(effectiveProgramTypeId) : null,
          course_type_id: isNoShowPlus ? (selectedCourseType?.id ?? null) : null,
          subject_id: showSubjectPicker && selectedTS ? selectedTS.subject_id : null,
          curriculum_id: showSubjectPicker && selectedTS ? selectedTS.curriculum_id : null,
          topic: null,
          video_link: null,
          fathom_summary: null,
          fathom_summary_doc_url: null,
          invoice_file_url: null,
          teacher_id: payloadTeacherId,
          coordinator_teacher_id: coordinatorId ? Number(coordinatorId) : null,
          no_show_type: noShowType,
          ...feedbackFields,
        }
      : {
          student_id: studentInvolved ? (selectedStudent?.id ?? null) : null,
          student_first_name: studentInvolved
            ? (selectedStudent?.first_name ?? (customStudentName.trim() || null))
            : null,
          student_last_name: studentInvolved ? (selectedStudent?.last_name ?? null) : null,
          session_date: sessionDate,
          session_duration_hrs: Number(duration),
          program_type_id: effectiveProgramTypeId ? Number(effectiveProgramTypeId) : null,
          course_type_id: selectedCourseType?.id ?? null,
          subject_id: showSubjectPicker && selectedTS ? selectedTS.subject_id : null,
          curriculum_id: showSubjectPicker && selectedTS ? selectedTS.curriculum_id : null,
          topic: effectiveTopic,
          video_link: isOfflineWork ? null : (videoLink || null),
          fathom_summary: isOfflineWork ? null : (fathomSummary.trim() || null),
          fathom_summary_doc_url: isOfflineWork ? null : summaryDocUrl,
          invoice_file_url: null,
          teacher_id: payloadTeacherId,
          // Ascend Offline Work repurposes this same column as "Assigned by"
          // (which teacher assigned the work) rather than leaving it null —
          // see the field's label in the JSX below.
          coordinator_teacher_id: coordinatorId ? Number(coordinatorId) : null,
          no_show_type: null,
          ...feedbackFields,
        };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = isEditing && id
      ? await updateSessionLog(Number(id), payload as any)
      : await createSessionLog(payload as any);

    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.data && !isEditing) {
      if (noShowType) {
        supabase.functions
          .invoke("notify-no-show", { body: { session_log_id: result.data.id } })
          .catch(() => {});
      } else {
        supabase.functions
          .invoke("notify-package-threshold", { body: { session_log_id: result.data.id } })
          .catch(() => {});
      }
      if (flagForCoach) {
        supabase.functions
          .invoke("notify-flag", { body: { session_log_id: result.data.id } })
          .catch(() => {});
      }
      if (result.data.pool_ambiguous || result.data.pool_fallback_used) {
        supabase.functions
          .invoke("notify-pool-issue", { body: { session_log_id: result.data.id } })
          .catch(() => {});
      }
    }

    // Optional subject note filed alongside the session — saved only when
    // there's real content (a body or a file). Best-effort and completely
    // separate from the session log: a note failure never undoes the saved
    // session. Its name is optional, falling back to the topic then "Note".
    const noteHasContent = noteText.trim() !== "" || noteFile != null;
    if (
      !noShowType &&
      showSubjectPicker &&
      selectedTS &&
      selectedStudent &&
      effectiveTeacherId &&
      noteHasContent
    ) {
      let noteFilePart: { file_name: string; file_url: string; file_type: string } | null = null;
      if (noteFile) {
        const { result: uploaded } = await uploadSubjectNoteFile(selectedStudent.id, noteFile);
        noteFilePart = uploaded;
      }
      await supabase.from("subject_notes").insert({
        student_id: selectedStudent.id,
        teacher_id: effectiveTeacherId,
        subject_id: selectedTS.subject_id,
        curriculum_id: selectedTS.curriculum_id,
        title: noteName.trim() || (effectiveTopic ? effectiveTopic.trim() : "") || "Note",
        note_text: noteText.trim() || null,
        file_name: noteFilePart?.file_name ?? null,
        file_url: noteFilePart?.file_url ?? null,
        file_type: noteFilePart?.file_type ?? null,
      });
    }

    navigate(isEditing && id ? viewPath(id) : backListPath);
  }

  if ((role === "teacher" && currentTeacherLoading) || loading) {
    return (
      <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /> Loading…</div>
    );
  }

  if (role === "teacher" && (currentTeacherError || !currentTeacher)) {
    return (
      <>
        <PageHeader title="Log a session" />
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {currentTeacherError ?? "Your teacher profile couldn't be loaded."}
        </p>
      </>
    );
  }

  if (role === "teacher" && isEditing && !isCoach) {
    return (
      <>
        <PageHeader title="Not allowed" />
        <Card className="p-6 max-w-xl">
          <p className="text-sm text-navy-700">
            Only Performance Coaches can edit a logged session. Contact your coach if this session needs a correction.
          </p>
          <Button className="mt-4" variant="ghost" onClick={() => id && navigate(viewPath(id))}>
            Back to session
          </Button>
        </Card>
      </>
    );
  }

  if (recordIsLocked) {
    const label = originalSessionDate
      ? new Date(originalSessionDate).toLocaleString("en-GB", { month: "long", year: "numeric" })
      : "";
    return (
      <>
        <PageHeader title="Session log locked" />
        <Card className="p-6 max-w-xl">
          <p className="text-sm text-navy-700">
            <span className="inline-block rounded-pill bg-navy-600 text-white px-2 py-0.5 text-xs font-semibold mr-2">🔒 locked</span>
            This session log is part of the {label} report, which has been locked. Locked months are frozen — the
            session log can't be edited{role === "admin" ? " or deleted" : ""}.
          </p>
          <Button className="mt-4" variant="ghost" onClick={() => id && navigate(viewPath(id))}>
            Back to session log
          </Button>
        </Card>
      </>
    );
  }

  const pageTitle = role === "admin"
    ? (isEditing ? "Edit session log" : "Add session log")
    : (isEditing ? "Edit session" : "Log a session");
  const pageDescription = role === "teacher" && currentTeacher
    ? `Logging as ${currentTeacher.first_name} ${currentTeacher.last_name ?? ""}`.trim()
    : undefined;
  const cardMaxWidth = role === "admin" ? "max-w-3xl" : "max-w-2xl";

  return (
    <>
      <PageHeader title={pageTitle} description={pageDescription} />

      <Card className={`p-6 ${cardMaxWidth}`}>
        {targetMonthLocked && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
            {lockedMonthLabel} is a locked report month — this session date can't be used.
          </p>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Type of program — shown first; drives the rest of the form.
              Also shown for every no-show type, exactly like a regular
              session — a no-show still happened for a specific program/
              subject, it just didn't bill unless it's No Show + (see
              utils/noShow.ts). */}
          <SelectInput
            label="Type of program"
            placeholder="Select a program type"
            value={topLevelProgramTypeId}
            onChange={(e) => handleTopLevelTypeChange(e.target.value)}
            options={topLevelTypes.map((pt) => ({ value: String(pt.id), label: pt.name }))}
            required
          />

          {/* Sub-program dropdown — for types with children (e.g. Student Offline Work) */}
          {hasSubTypes && (
            <SelectInput
              label="Sub-program"
              placeholder="Select a sub-program"
              value={subTypeId}
              onChange={(e) => setSubTypeId(e.target.value)}
              options={groupSubTypes.map((st) => ({ value: String(st.id), label: st.name }))}
              required
            />
          )}

          {/* Teacher — admin-only free choice; scoped Curriculum/Section/
              Subject below are drawn from whichever teacher is selected
              here, exactly like when a teacher logs their own session. */}
          {role === "admin" && (
            <SelectInput
              label="Teacher"
              placeholder="Select the teacher"
              value={teacherId}
              onChange={(e) => handleTeacherChange(e.target.value)}
              options={teachers.map((t) => ({
                value: String(t.id),
                label: `${t.first_name} ${t.last_name ?? ""}`.trim(),
              }))}
              required
            />
          )}

          {/* Student + Date */}
          <div className="grid grid-cols-2 gap-4">
            {(noShowType || studentInvolved) && (
              isDemoLesson ? (
                <div className="flex flex-col gap-2">
                  <StudentSearch
                    label="Student (search if they already exist)"
                    value={selectedStudent?.id ?? null}
                    onChange={(s) => { setSelectedStudent(s); if (s) setCustomStudentName(""); }}
                    allowedIds={assignedStudentIds}
                    emptyAllowedMessage={isCoach || isCounsellor ? "No students are assigned to you yet." : undefined}
                  />
                  {!selectedStudent && (
                    <TextInput
                      label="Or enter student name (not in system yet)"
                      value={customStudentName}
                      onChange={(e) => setCustomStudentName(e.target.value)}
                      placeholder="Student's full name"
                    />
                  )}
                </div>
              ) : (
                <StudentSearch
                  label="Student"
                  value={selectedStudent?.id ?? null}
                  onChange={setSelectedStudent}
                  required
                  allowedIds={assignedStudentIds}
                  emptyAllowedMessage={isCoach || isCounsellor ? "No students are assigned to you yet — ask an admin to assign one." : undefined}
                />
              )
            )}
            <TextInput
              label="Session date"
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              required
            />
          </div>

          {/* No Show toggle — not applicable to Demo Lesson or offline work (Ascend/Academic/Beyond Academic) */}
          {!isDemoLesson && !isOfflineWork && (
          <div className="flex items-center gap-3">
            {noShowType ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-amber-100 text-amber-700 px-3 py-1 text-sm font-medium">
                  {NO_SHOW_LABELS[noShowType]}
                </span>
                <button
                  type="button"
                  onClick={clearNoShow}
                  className="text-xs text-navy-400 hover:text-red-500 underline"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div ref={noShowRef} className="relative">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowNoShowMenu((v) => !v)}
                  className="border border-amber-200 text-amber-600 hover:bg-amber-50"
                >
                  No Show ▾
                </Button>
                {showNoShowMenu && (
                  <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-navy-100 rounded-xl shadow-md min-w-[140px]">
                    {(Object.keys(NO_SHOW_LABELS) as NoShowType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleNoShowSelect(type)}
                        className="block w-full text-left px-4 py-2 text-sm hover:bg-amber-50 text-navy-700"
                      >
                        {NO_SHOW_LABELS[type]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* Subject — shown for every session, no-shows included, exactly
              like a regular session (see utils/noShow.ts for what stays
              non-billable regardless of subject being on file). */}
          <>
              {/* Curriculum/Section/Subject depend on which teacher's
                  subjects they're drawn from — nudge toward picking one
                  (admin only; a teacher/coach's own identity is always
                  known, so this can never show for them). */}
              {(isAcademic || isBeyondAcademic || isCollegeCounselling) && !effectiveTeacherId && (
                <p className="text-sm text-navy-400 italic">Select a teacher above to see their curricula/subjects.</p>
              )}

              {/* Academics: curriculum first, then subject — scoped to the
                  selected teacher's own assigned subjects */}
              {isAcademic && effectiveTeacherId && (
                <>
                  <SelectInput
                    label="Curriculum"
                    placeholder="Select a curriculum"
                    value={teacherCurriculumId}
                    onChange={(e) => {
                      setTeacherCurriculumId(e.target.value);
                      setTeacherGroupId(null);
                      setTeacherSubjectId("");
                    }}
                    options={teacherCurriculumOptions}
                    required
                  />

                  {/* Subject Group — shown only for curricula that have groups */}
                  {teacherCurriculumId && hasGroups && (
                    <SelectInput
                      label="Subject Group"
                      placeholder="Select a group"
                      value={teacherGroupId !== null ? String(teacherGroupId) : ""}
                      onChange={(e) => {
                        setTeacherGroupId(e.target.value ? Number(e.target.value) : null);
                        setTeacherSubjectId("");
                      }}
                      options={availableGroups.map((g) => ({ value: String(g.id), label: g.name }))}
                      required
                    />
                  )}

                  {isUngroupedCurriculum && filteredAcademicSubs.length === 0 && (
                    <p className="text-sm text-navy-400 italic">
                      {role === "admin"
                        ? "This teacher isn't assigned a subject under this curriculum yet — add one on the Subjects & Curricula page."
                        : "You're not assigned a subject under this curriculum yet — ask an admin to add one."}
                    </p>
                  )}

                  {/* Always shown once there's at least one subject to pick —
                      even with exactly one option, the user must actively
                      select it (no silent auto-logging). Level (e.g. SL/HL)
                      is its own dropdown after Subject, never baked into the
                      same option — see db/docs/SUBJECT_HIERARCHY.md §2. */}
                  {(teacherCurriculumId === "null"
                    || (teacherCurriculumId && hasGroups && teacherGroupId !== null)
                    || (isUngroupedCurriculum && filteredAcademicSubs.length >= 1)) && (
                    <SubjectLevelSelect
                      subjects={filteredAcademicSubjects}
                      value={selectedTS ? String(selectedTS.subject_id) : ""}
                      onChange={handleAcademicSubjectLevelChange}
                      required
                    />
                  )}
                </>
              )}

              {/* Beyond Academics: subjects sit directly under it — one flat
                  dropdown, no sections/categories at all — scoped to the
                  selected teacher's own assigned subjects */}
              {isBeyondAcademic && effectiveTeacherId && (
                <BeyondAcademicSubjectSelect
                  options={beyondAcademicOptions}
                  value={teacherSubjectId}
                  onChange={handleSubjectChange}
                  required
                />
              )}

              {/* College Counselling: subjects (College Counselling, College
                  Essays) sit directly under it — same flat picker as Beyond
                  Academics, no grouping/sections. */}
              {isCollegeCounselling && effectiveTeacherId && (
                <BeyondAcademicSubjectSelect
                  options={collegeCounsellingOptions}
                  value={teacherSubjectId}
                  onChange={handleSubjectChange}
                  required
                />
              )}

              {/* Work for Ascend Now — specification field; no-shows never
                  involve this type (see topLevelTypes' No Show + restriction
                  to Academic/Beyond Academic, and Work for Ascend Now has no
                  student to no-show on in the first place) */}
              {!noShowType && isWorkForAscend && (
                <TextInput
                  label="Work specification"
                  value={workForAscendSpec}
                  onChange={(e) => setWorkForAscendSpec(e.target.value)}
                  placeholder="Describe the work done for Ascend Now…"
                />
              )}
          </>

          {/* Session duration — typed in for a regular session. Never asked
              for any no-show type, including No Show + — the hours it cuts
              from a package are a fixed admin-configured constant (see
              session_duration_settings / useSessionDurationSettings), set
              automatically in handleNoShowSelect, not something a teacher
              (or admin, from this form) chooses per log. */}
          {!noShowType && (
            <SelectInput
              label="Session duration"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              options={DURATION_OPTIONS}
              required
            />
          )}

          {/* Regular-session-only fields — no meeting happens for a no-show
              of any type, so there's never a topic/video/summary to record. */}
          {!noShowType && (
            <>
              <div className={`grid gap-4 ${isOfflineWork ? "grid-cols-1" : "grid-cols-2"}`}>
                <TextInput
                  label="Topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Diagnostic"
                  required
                />
                {!isOfflineWork && (
                  <div className="flex flex-col gap-1">
                    <TextInput
                      label="Video link (Fathom)"
                      value={videoLink}
                      onChange={(e) => handleVideoLinkChange(e.target.value)}
                      placeholder="https://fathom.video/share/…"
                      required
                    />
                    {videoLinkError && (
                      <p className="text-xs text-red-500">{videoLinkError}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Fathom transcript — no meeting happens for offline work */}
              {!isOfflineWork && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-navy-500">
                    Fathom transcript <span className="text-red-500 ml-0.5">*</span>
                  </label>
                  <textarea
                    value={fathomSummary}
                    onChange={(e) => setFathomSummary(e.target.value)}
                    placeholder="Paste or type the session transcript from Fathom…"
                    rows={4}
                    required
                    className="rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 placeholder-navy-300 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-y"
                  />
                  {fathomSummary.trim() && (
                    <p className="text-xs text-navy-400">Transcript will be saved as a .docx file in storage.</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Teacher Feedback Section — hidden for no-shows and student-less sessions ── */}
          {!noShowType && studentInvolved && <div className="border-t border-navy-50 pt-4 flex flex-col gap-4">
            {/* Independent work — not applicable to demo lessons */}
            {!isDemoLesson && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-navy-500">
                  Has the student completed any independent work before this session?
                </label>
                <select
                  value={independentWork}
                  onChange={(e) => setIndependentWork(e.target.value as IndependentWorkOption | "")}
                  className="rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  <option value="">Select…</option>
                  {INDEPENDENT_WORK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Engagement rating — no meeting happens for offline work */}
            {!isOfflineWork && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-navy-500">Student engagement rating</label>
                <select
                  value={engagementRating}
                  onChange={(e) => setEngagementRating(e.target.value as EngagementRating | "")}
                  className="rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  <option value="">Select…</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            )}

            {/* Performance feedback */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-navy-500">
                Feedback on student's performance during today's session
              </label>
              <textarea
                value={performanceFeedback}
                onChange={(e) => setPerformanceFeedback(e.target.value)}
                placeholder="Share your observations about the student's performance…"
                rows={3}
                className="rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 placeholder-navy-300 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-y"
              />
            </div>

            {/* Flag for performance coach */}
            <div className="flex flex-col gap-3">
              <label className="text-xs font-medium text-navy-500">
                Flag for Performance Coach?
              </label>
              <div className="flex gap-2">
                {([true, false] as const).map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setFlagForCoach(v)}
                    className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      flagForCoach === v
                        ? v
                          ? "bg-red-500 border-red-500 text-white"
                          : "bg-sky-500 border-sky-500 text-white"
                        : "bg-white border-navy-100 text-navy-500 hover:border-sky-200"
                    }`}
                  >
                    {v ? "Yes" : "No"}
                  </button>
                ))}
              </div>

              {flagForCoach && (
                <div className="flex flex-col gap-3 pl-2 border-l-2 border-red-200">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-navy-500">
                      What would you like to flag?
                    </label>
                    <select
                      value={flagCategory}
                      onChange={(e) => setFlagCategory(e.target.value)}
                      className="rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                    >
                      <option value="">Select a category…</option>
                      {FLAG_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-navy-500">
                      Additional comments <span className="text-red-400 ml-0.5">*</span>
                    </label>
                    <textarea
                      value={flagComments}
                      onChange={(e) => setFlagComments(e.target.value)}
                      placeholder="Provide context for the Performance Coach…"
                      rows={3}
                      required={flagForCoach}
                      className="rounded-xl border border-navy-100 px-3 py-2 text-sm text-navy-700 placeholder-navy-300 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-y"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>}

          {/* With a student in play the coach is read-only — it's whoever the
              student is assigned to, and nobody may file a session against a
              different one. Ascend Offline Work repurposes this same field as
              "Assigned by" (which teacher assigned the work, distinct from
              "Teacher" above, who performed it); that type has no student, so
              it keeps a picker over the coach list. */}
          {coordinatorField.mode === "derived" ? (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-navy-600">Performance Coach</label>
              <div className="rounded-xl border border-navy-100 bg-navy-50/40 px-4 py-2.5 text-sm text-navy-700">
                {coordinatorField.teacherId
                  ? coordinatorName(coordinatorField.teacherId)
                  : <span className="text-navy-400">{coordinatorField.hint}</span>}
              </div>
            </div>
          ) : studentInvolved ? (
            // Demo lesson for someone not in the database — no assignment to
            // derive from, so the whole coach list is offered. Optional: the
            // coach may not be settled at demo time.
            <SelectInput
              label="Performance Coach"
              placeholder="Select a Performance Coach"
              value={coordinatorId}
              onChange={(e) => setCoordinatorId(e.target.value)}
              options={coaches.map((t) => ({
                value: String(t.id),
                label: `${t.first_name} ${t.last_name ?? ""}`.trim(),
              }))}
            />
          ) : (
            <SelectInput
              label="Assigned by"
              placeholder="Which teacher assigned this offline work?"
              value={coordinatorId}
              onChange={(e) => setCoordinatorId(e.target.value)}
              options={coaches.map((t) => ({
                value: String(t.id),
                label: `${t.first_name} ${t.last_name ?? ""}`.trim(),
              }))}
              required
            />
          )}

          {/* Optional subject note filed straight from the session-log form.
              No separate button — it's saved as part of "Log session" when
              there's content, straight into subject_notes (shown on the
              student's Overview), never stored on or shown with the session
              log itself. */}
          {!noShowType && selectedStudent && showSubjectPicker && selectedTS && effectiveTeacherId && (
            <div className="border-t border-navy-50 pt-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-navy-700">Add a note for this subject</p>
              <TextInput
                label="Note name"
                value={noteName}
                onChange={(e) => setNoteName(e.target.value)}
                placeholder="e.g. Chapter 3 revision notes"
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-navy-700">Note</label>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                  placeholder="Type a note…"
                  className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-700 placeholder:text-navy-200 focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-navy-700">Attachment (any format)</label>
                <input
                  type="file"
                  onChange={(e) => setNoteFile(e.target.files?.[0] ?? null)}
                  className="text-sm text-navy-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-100 file:px-3 file:py-1.5 file:text-sky-700 file:font-medium hover:file:bg-sky-200"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 mt-2">
            <Button type="submit" disabled={saving || !!videoLinkError || targetMonthLocked}>
              {saving
                ? "Saving…"
                : noShowType
                  ? "Log no show"
                  : isEditing
                    ? "Save changes"
                    : role === "admin" ? "Add session" : "Log session"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(role === "admin" ? backListPath : (isEditing && id ? viewPath(id) : backListPath))}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
