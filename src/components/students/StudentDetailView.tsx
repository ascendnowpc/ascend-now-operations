import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useAuth } from "../../context/AuthContext";
import { useCourseTypes } from "../../hooks/useCourseTypes";
import { useProgramTypes } from "../../hooks/useProgramTypes";
import { useStudentPackages } from "../../hooks/useStudentPackages";
import { useInvoices, type InvoiceWithItems, type InvoiceLineItemWithNames, type SessionLogDetailed } from "../../hooks/useInvoices";
import { useSubjects } from "../../hooks/useSubjects";
import { useCurricula } from "../../hooks/useCurricula";
import { useTeachers, useAllTeacherSubjects } from "../../hooks/useTeachers";
import { usePcAssignments } from "../../hooks/usePcAssignments";
import { HomeworkResultsList } from "../homework/HomeworkResultsList";
import { CoordinatorLogHistoryList } from "../coordinatorLogs/CoordinatorLogHistoryList";
import type { PackageTopup, SessionLog, Student, StudentPackage } from "../../types/database";
import { CURRICULUM_OPTIONS } from "../portal/curriculumOptions";
import { supabase } from "../../lib/supabaseClient";
import { invalidateCachePrefix } from "../../lib/cache";
import { COUNTRY_CODES, splitPhone, joinPhone } from "../../data/countryCodes";
import { buildSingleInvoicePdf, aggregateReportSections, resolveReportSection, type PackageMeta, type ReportSection, type ReportRawLine } from "../../utils/buildInvoicePdf";
import { ReportSectionsView } from "../../components/ui/ReportSectionsView";
import { RowMenu, type RowMenuAction } from "../../components/ui/RowMenu";
import { formatHours } from "../../utils/formatHours";
import { subjectLabel, sessionTopicLabel } from "../../utils/subjectLabel";
import { toLocalDateString } from "../../utils/localDate";
import { isNonBillableNoShow } from "../../utils/noShow";
import { NO_SHOW_LABELS } from "../../utils/teacherPeriodDetail";

type PackageWithTopups = StudentPackage & { package_topups: PackageTopup[] };
type Tab = "details" | "packages" | "homework" | "coordinatorLog" | "invoices";

const COUNTRIES = COUNTRY_CODES.map((c) => c.name);
const COUNTRY_TO_DIAL_CODE: Record<string, string> = Object.fromEntries(
  COUNTRY_CODES.map((c) => [c.name, c.code])
);

const CURRENT_YEAR = new Date().getFullYear();
const GRADUATION_YEARS = Array.from({ length: 20 }, (_, i) => CURRENT_YEAR - 5 + i);

const PROGRAM_TYPE_TO_COURSE_TYPE_NAME: Record<string, string> = {
  academic: "Academic",
  beyond_academic: "Beyond Academic",
  college_counselling: "College Counselling",
};

// Filters the subject dropdown on the "add assignment rule" form to just
// the subjects that actually belong to the chosen pool's course type.
// Beyond Academic subjects were flattened (2026-07-02) to have no grouping
// at all — `category` is legacy free text (NOT a reliable "beyond_academic"
// literal for every row), so the only correct check is the same one used
// everywhere else in the app (e.g. AdminTeacherFormPage.tsx's Beyond
// Academic picker): not academic, not College Counselling, and not left
// under a legacy category_id. College Counselling subjects (College
// Counselling, College Essays) use the distinct 'college_counselling'
// category value instead. Other course types (bundle grouping types are
// never a pool's own course type) have no subjects at all — those
// sessions carry a program type instead, so the rule can only be "any
// subject" for them.
function candidateSubjectsForCourseType<T extends { category: string; category_id: number | null }>(
  courseTypeName: string | undefined,
  subjects: T[]
): T[] {
  if (courseTypeName === "Academic") return subjects.filter((s) => s.category === "academic");
  if (courseTypeName === "Beyond Academic") return subjects.filter((s) => s.category !== "academic" && s.category !== "college_counselling" && s.category_id == null);
  if (courseTypeName === "College Counselling") return subjects.filter((s) => s.category === "college_counselling");
  return [];
}

function courseTypeBadge(color: string | null) {
  switch (color) {
    case "green":  return "bg-green-100 text-green-700 border-green-200";
    case "orange": return "bg-orange-100 text-orange-700 border-orange-200";
    case "purple": return "bg-purple-100 text-purple-700 border-purple-200";
    case "sky":    return "bg-sky-100 text-sky-700 border-sky-200";
    case "amber":  return "bg-amber-100 text-amber-700 border-amber-200";
    case "navy":   return "bg-navy-50 text-navy-600 border-navy-100";
    default:       return "bg-navy-50 text-navy-600 border-navy-100";
  }
}

// A no-show still deducts hours (No Show +) but never held an actual
// session — label it as its own count rather than folding it into
// "sessions", so it reads as a deduction, not a meeting that happened.
function sessionCountLabel(sessionCount: number, noShowCount: number): string {
  const parts: string[] = [];
  if (sessionCount > 0) parts.push(`${sessionCount} session${sessionCount !== 1 ? "s" : ""}`);
  if (noShowCount > 0) parts.push(`${noShowCount} no-show${noShowCount !== 1 ? "s" : ""}`);
  return parts.join(" + ") || "0 sessions";
}

function BalanceBar({ used, total }: { used: number; total: number }) {
  // A package can have 0 purchased hours (e.g. the zero-hour pool
  // auto-created when a session is logged with no matching package at
  // all) yet still have used hours logged against it — an overage from
  // the moment it exists. Treat that as a full (red) bar rather than 0%.
  const rawPct = total > 0 ? used / total : used > 0 ? 1 : 0;
  const pct = Math.min(rawPct, 1);
  const fill = pct >= 0.9 ? "bg-red-500" : pct >= 0.75 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-navy-50 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full ${fill}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="text-xs text-navy-500 shrink-0 tabular-nums">
        {formatHours(used)} / {formatHours(total)} hrs used {total > 0 ? `(${Math.round(rawPct * 100)}%)` : used > 0 ? "(over)" : ""}
      </span>
    </div>
  );
}

/**
 * Shared student-detail view used by BOTH the admin (`/admin/students/:id`)
 * and the performance-coach (`/teacher/students/:id`) pages — one component
 * so the Details / Learner's-actual-hours / Reports tabs can never drift
 * apart again. The two roles differ ONLY in:
 *   - which layout wraps it (each page supplies its own) and the back link
 *     (`backPath`/`backLabel`);
 *   - a PC cannot edit contact details (the "Edit" control is admin-only —
 *     the same rich read-only view is shown to both), and
 *   - a PC has no "renew / add hours" affordance (that route is admin-only;
 *     hours only ever come from the enroll → invoice → confirm flow).
 * Everything else — the package/pool cards, Pending Deduction, the
 * teacher/subject → project assignments, and the full report powers
 * (generate by package/date, download, lock, delete) — is identical, and
 * RLS already scopes a PC to only their assigned students.
 */
export function StudentDetailView({ role, backPath, backLabel }: {
  role: "admin" | "pc";
  backPath: string;
  backLabel: string;
}) {
  const isAdmin = role === "admin";
  const { id: studentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const { courseTypes } = useCourseTypes();
  const { programTypes } = useProgramTypes();
  const {
    fetchPackagesForStudent, fetchSessionsForBalance, computeHoursUsedBySubject, computeHoursUsedByTeacher,
    fetchPendingPoolSessions, fetchPoolResolutions, deletePoolResolution,
    resolvePendingSession, updatePoolResolutionTarget, createPoolResolution,
  } = useStudentPackages();
  const {
    fetchInvoicesForStudent, generateInvoice, generateInvoiceForPackages,
    fetchSessionLogsForPackages, fetchSessionLogsForDateRange,
    lockInvoice, setInvoicePublished, deleteInvoice, regenerateInvoice, buildInvoiceSections,
  } = useInvoices();
  const { subjects } = useSubjects();
  const { curricula } = useCurricula();
  const { teachers } = useTeachers();
  const { subjectsByTeacher } = useAllTeacherSubjects();
  const { getPcForStudent } = usePcAssignments();

  const tabParam = searchParams.get("tab");
  const initialTab: Tab =
    tabParam === "packages" || tabParam === "invoices" || tabParam === "homework" || tabParam === "coordinatorLog" ? tabParam : "details";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [student, setStudent] = useState<Student | null>(null);
  const [loadingStudent, setLoadingStudent] = useState(true);
  // The student's own login username, shown read-only on the Details tab.
  // There is no separate parent account anymore — the guardian's name/phone
  // are plain fields on the student record.
  const [studentUsername, setStudentUsername] = useState<string | null>(null);
  const [reportCardUrl, setReportCardUrl] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageWithTopups[]>([]);
  const [sessions, setSessions] = useState<Pick<SessionLog, "id" | "session_date" | "course_type_id" | "program_type_id" | "student_package_id" | "session_duration_hrs" | "no_show_type" | "subject_id" | "curriculum_id" | "teacher_id" | "pool_ambiguous">[]>([]);
  const [invoices, setInvoices] = useState<InvoiceWithItems[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [expandedTopups, setExpandedTopups] = useState<Set<number>>(new Set());

  // Clicking a By-subject / By-teacher row in a package card deep-links to the
  // full Session Logs list, pre-filtered to that subject/teacher for this
  // student — admin → /admin/session-logs, PC → /teacher/student-logs. A PC
  // must land on "My Students' Logs" (every session for their assigned
  // students, by any teacher), NOT /teacher/sessions (the coach's OWN logs,
  // scoped to their teacher id) — the latter would show nothing here, since the
  // coach isn't the teacher_id on their students' sessions.
  const sessionLogsBasePath = isAdmin ? "/admin/session-logs" : "/teacher/student-logs";

  // Pending Deduction — session logs that couldn't be auto-assigned to a
  // package because this student has more than one active pool for their
  // course_type and no (teacher, subject) resolution exists yet.
  const [pendingSessions, setPendingSessions] = useState<Awaited<ReturnType<typeof fetchPendingPoolSessions>>>([]);
  const [pendingChoice, setPendingChoice] = useState<Map<number, number>>(new Map());
  const [poolActionBusyId, setPoolActionBusyId] = useState<number | null>(null);
  const [poolActionError, setPoolActionError] = useState<string | null>(null);
  const [poolResolutions, setPoolResolutions] = useState<Awaited<ReturnType<typeof fetchPoolResolutions>>>([]);
  const [showPoolResolutions, setShowPoolResolutions] = useState(false);
  const [editingResolutionId, setEditingResolutionId] = useState<number | null>(null);

  // "+ Add assignment" — lets an admin set up a teacher/subject -> project
  // assignment proactively, before any session has been logged at all,
  // rather than waiting for the first ambiguous session.
  const [showAddResolution, setShowAddResolution] = useState(false);
  const [newResolutionPoolId, setNewResolutionPoolId] = useState<number | "">("");
  const [newResolutionTeacherId, setNewResolutionTeacherId] = useState<number | "">("");
  const [newResolutionSubjectId, setNewResolutionSubjectId] = useState<number | "">("");
  const [addResolutionSaving, setAddResolutionSaving] = useState(false);
  const [addResolutionError, setAddResolutionError] = useState<string | null>(null);

  // Contact edit
  const [editingContact, setEditingContact] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactForm, setContactForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    notification_email: "",
    curriculum: "",
    parent_full_name: "",
    parent_phone_code: "+971",
    parent_phone_num: "",
    phone_code: "+971",
    phone_num: "",
    address: "",
    country: "UAE",
    school: "",
    graduation_year: "",
    birthday: "",
  });
  const [contactError, setContactError] = useState<string | null>(null);

  // Invoice form
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invStart, setInvStart] = useState("");
  const [invEnd, setInvEnd] = useState("");
  const [invSaving, setInvSaving] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);

  // Package-wise invoice form
  const [showPkgInvoiceForm, setShowPkgInvoiceForm] = useState(false);
  const [selectedPackageIds, setSelectedPackageIds] = useState<Set<number>>(new Set());
  const [pkgInvoiceSaving, setPkgInvoiceSaving] = useState(false);
  const [pkgInvoiceError, setPkgInvoiceError] = useState<string | null>(null);
  const [lockingInvoiceId, setLockingInvoiceId] = useState<number | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  // Lock-with-refresh flow: the invoice awaiting lock confirmation (after its
  // numbers were just regenerated), plus the row to force-open so the admin
  // can review those refreshed totals before confirming.
  const [pendingLockInvoice, setPendingLockInvoice] = useState<InvoiceWithItems | null>(null);
  const [forceOpenInvoiceId, setForceOpenInvoiceId] = useState<number | null>(null);
  const [publishingInvoiceId, setPublishingInvoiceId] = useState<number | null>(null);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<number | null>(null);
  const [pendingDeleteInvoice, setPendingDeleteInvoice] = useState<InvoiceWithItems | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function reload() {
    if (!studentId) return;
    const { data } = await supabase.from("students").select("*").eq("id", studentId).single();
    const s = data as Student | null;
    setStudent(s);
    setLoadingStudent(false);

    if (s?.user_id) {
      const { data: u } = await supabase.from("users").select("username").eq("id", s.user_id).maybeSingle();
      setStudentUsername(u?.username ?? null);
    } else {
      setStudentUsername(null);
    }

    // The optional report card lives in a private bucket — sign a short-lived
    // URL so it can be viewed/downloaded from the read-only detail view.
    if (s?.report_card_url) {
      const { data: signed } = await supabase.storage.from("report-cards").createSignedUrl(s.report_card_url, 3600);
      setReportCardUrl(signed?.signedUrl ?? null);
    } else {
      setReportCardUrl(null);
    }

    setLoadingPackages(true);
    const [pkgs, sess, invs, pending, resolutions] = await Promise.all([
      fetchPackagesForStudent(studentId),
      fetchSessionsForBalance(studentId),
      fetchInvoicesForStudent(studentId),
      fetchPendingPoolSessions(studentId),
      fetchPoolResolutions(studentId),
    ]);
    setPackages(pkgs);
    setSessions(sess);
    setInvoices(invs);
    setPendingSessions(pending);
    setPoolResolutions(resolutions);
    setLoadingPackages(false);
  }

  useEffect(() => { reload(); }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjectLookup = new Map(subjects.map((s) => [s.id, { name: s.name, level: s.level }]));
  const curriculumLookup = new Map(curricula.map((c) => [c.id, c.name]));
  const teacherLookup = new Map(teachers.map((t) => [t.id, `${t.first_name} ${t.last_name ?? ""}`.trim()]));
  const subjectName = (id: number | null) => (id != null ? (subjectLookup.get(id)?.name ?? null) : null);

  // Package lookup (id -> package), used by the invoice generate/lock flows.
  const packageById = new Map<number, PackageWithTopups>();
  for (const pkg of packages) packageById.set(pkg.id, pkg);

  // Lookups for turning an invoice's line items into report sections
  // (course type / bundle pool → subject → teacher). Shared by the invoice
  // list's on-screen view and its downloaded PDF.
  const packageMetaById = new Map<number, PackageMeta>(
    packages.map((p) => [p.id, { course_type_id: p.course_type_id, package_type_id: p.package_type_id, pool_label: p.pool_label }])
  );
  const courseTypeNameById = (id: number | null) =>
    (id != null ? courseTypes.find((c) => c.id === id)?.name : undefined) ?? (id != null ? `Type ${id}` : "Other");
  const sectionsForLineItems = (lineItems: InvoiceLineItemWithNames[]) =>
    buildInvoiceSections(lineItems, packageMetaById, courseTypeNameById);
  const hoursBySubject = computeHoursUsedBySubject(sessions as Parameters<typeof computeHoursUsedBySubject>[0]);

  // Fallback mapping for sessions whose course_type_id wasn't backfilled:
  // course_type_id -> set of program_type_id values (including subtypes,
  // e.g. "IB DP" under "Academic") that belong to that course type.
  const courseTypeToProgramTypeIds = new Map<number, Set<number>>();
  for (const pt of programTypes) {
    const topLevel = pt.parent_id == null ? pt : programTypes.find((p) => p.id === pt.parent_id);
    if (!topLevel?.type) continue;
    const ctName = PROGRAM_TYPE_TO_COURSE_TYPE_NAME[topLevel.type];
    const ct = ctName ? courseTypes.find((c) => c.name === ctName) : undefined;
    if (!ct) continue;
    if (!courseTypeToProgramTypeIds.has(ct.id)) courseTypeToProgramTypeIds.set(ct.id, new Set());
    courseTypeToProgramTypeIds.get(ct.id)!.add(pt.id);
  }

  function startEditContact() {
    if (!student) return;
    const { code, number } = splitPhone(student.phone_number ?? null);
    const parentPhone = splitPhone(student.parent_phone_number ?? null);
    setContactForm({
      first_name: student.first_name ?? "",
      last_name:  student.last_name  ?? "",
      email:     student.email   ?? "",
      notification_email: student.notification_email ?? "",
      curriculum: student.curriculum ?? "",
      parent_full_name: student.parent_full_name ?? "",
      parent_phone_code: parentPhone.code,
      parent_phone_num:  parentPhone.number,
      phone_code: code,
      phone_num: number,
      address:   student.address ?? "",
      country:   student.country ?? "UAE",
      school:    student.school ?? "",
      graduation_year: student.graduation_year != null ? String(student.graduation_year) : "",
      birthday:  student.birthday ?? "",
    });
    setEditingContact(true);
    setContactError(null);
  }

  async function saveContact() {
    if (!studentId) return;
    if (!contactForm.first_name.trim() || !contactForm.last_name.trim()) {
      setContactError("First name and last name are required.");
      return;
    }
    setContactSaving(true);
    const { error } = await supabase
      .from("students")
      .update({
        first_name:       contactForm.first_name.trim(),
        last_name:        contactForm.last_name.trim(),
        email:            contactForm.email   || null,
        notification_email: contactForm.notification_email || null,
        curriculum:       contactForm.curriculum || null,
        parent_full_name: contactForm.parent_full_name || null,
        parent_phone_number: joinPhone(contactForm.parent_phone_code, contactForm.parent_phone_num),
        phone_number:     joinPhone(contactForm.phone_code, contactForm.phone_num),
        address:          contactForm.address || null,
        country:          contactForm.country || null,
        school:           contactForm.school || null,
        graduation_year:  contactForm.graduation_year ? Number(contactForm.graduation_year) : null,
        birthday:         contactForm.birthday || null,
      })
      .eq("id", studentId);
    if (error) { setContactSaving(false); setContactError(error.message); return; }

    setContactSaving(false);
    invalidateCachePrefix("students:");
    setEditingContact(false);
    reload();
  }

  async function resolvePending(sessionLogId: number) {
    if (!profile) return;
    const chosenPackageId = pendingChoice.get(sessionLogId);
    if (!chosenPackageId) return;
    setPoolActionBusyId(sessionLogId);
    setPoolActionError(null);
    const { error } = await resolvePendingSession({
      sessionLogId,
      studentPackageId: chosenPackageId,
      resolvedByUserId: profile.id,
    });
    setPoolActionBusyId(null);
    if (error) { setPoolActionError(error); return; }
    reload();
  }

  // Changes which pool a (teacher, subject) resolution rule points to.
  // Affects any brand-new session logged with that teacher+subject from now
  // on, and sweeps currently-pending (not-yet-deducted) sessions matching it
  // — but never touches an already-resolved session, which keeps whatever
  // pool it was already counted against.
  async function changeResolutionTarget(resolutionId: number, studentPackageId: number) {
    if (!profile) return;
    setPoolActionBusyId(resolutionId);
    setPoolActionError(null);
    const { error } = await updatePoolResolutionTarget({ resolutionId, studentPackageId, resolvedByUserId: profile.id });
    setPoolActionBusyId(null);
    if (error) { setPoolActionError(error); return; }
    setEditingResolutionId(null);
    reload();
  }

  function openAddResolution() {
    setShowAddResolution(true);
    setNewResolutionPoolId("");
    setNewResolutionTeacherId("");
    setNewResolutionSubjectId("");
    setAddResolutionError(null);
  }
  function closeAddResolution() { setShowAddResolution(false); }

  // Proactively sets up a teacher/subject -> project assignment before any
  // session has been logged at all. Only ever affects sessions logged from
  // now on (and any already-pending ones matching the same key) — never an
  // already-resolved session.
  async function handleAddResolution() {
    if (!profile || newResolutionPoolId === "" || newResolutionTeacherId === "") return;
    const pool = packages.find((p) => p.id === newResolutionPoolId);
    if (!pool) return;
    setAddResolutionSaving(true);
    setAddResolutionError(null);
    const { error } = await createPoolResolution({
      studentId: pool.student_id,
      courseTypeId: pool.course_type_id,
      teacherId: Number(newResolutionTeacherId),
      subjectId: newResolutionSubjectId === "" ? null : Number(newResolutionSubjectId),
      studentPackageId: pool.id,
      resolvedByUserId: profile.id,
    });
    setAddResolutionSaving(false);
    if (error) { setAddResolutionError(error); return; }
    closeAddResolution();
    reload();
  }

  // Forces the next session matching this cached (teacher, subject) ->
  // pool rule back into pool_ambiguous — for when a PC knows the
  // underlying project has changed even though nothing in the data shows
  // it (see db/README.md's multi-pool packages section).
  async function resetPoolResolution(resolutionId: number) {
    setPoolActionBusyId(resolutionId);
    setPoolActionError(null);
    const { error } = await deletePoolResolution(resolutionId);
    setPoolActionBusyId(null);
    if (error) { setPoolActionError(error); return; }
    reload();
  }

  // Whole-student "Download Report" (Details tab) — same sectioned format as
  // the per-invoice reports: course type / bundle pool → program/subject →
  // teacher, built from every billable session the student has ever had.
  function handleDownloadInvoice() {
    if (!student) return;
    const billable = sessions.filter((s) => !isNonBillableNoShow(s.no_show_type) && s.course_type_id != null);
    const rawLines: ReportRawLine[] = billable.map((s) => {
      const subj = s.subject_id != null ? subjectLookup.get(s.subject_id) : undefined;
      return {
        student_package_id: s.student_package_id ?? null,
        course_type_id: s.course_type_id ?? null,
        subject_id: s.subject_id ?? null,
        subjectName: subj?.name ?? null,
        subjectLevel: subj?.level ?? null,
        curriculumName: s.curriculum_id != null ? (curriculumLookup.get(s.curriculum_id) ?? null) : null,
        program_type_id: s.program_type_id ?? null,
        programTypeName: s.program_type_id != null ? (programTypes.find((p) => p.id === s.program_type_id)?.name ?? null) : null,
        teacherName: s.teacher_id != null ? (teacherLookup.get(s.teacher_id) ?? "—") : "—",
        hours: s.session_duration_hrs ?? 0,
        session_count: 1,
        // Only No Show + reaches here (isNonBillableNoShow already excluded
        // No Show 1/2 above) — it still deducted an hour, so it's flagged
        // rather than shown as an indistinguishable completed session.
        isNoShow: s.no_show_type != null,
      };
    });
    const sectionsAll = aggregateReportSections(rawLines, (spid, ctid) => resolveReportSection(spid, ctid, packageMetaById, courseTypeNameById));
    const totalHours = rawLines.reduce((sum, l) => sum + l.hours, 0);
    const dates = billable.map((s) => s.session_date).sort();
    const today = toLocalDateString(new Date());
    buildSingleInvoicePdf({
      student,
      periodStart: dates[0] ?? today,
      periodEnd: dates[dates.length - 1] ?? today,
      totalHours,
      sections: sectionsAll,
    });
  }

  async function handleGenerateInvoice() {
    if (!studentId || !profile || !invStart || !invEnd) return;
    setInvSaving(true);
    setInvError(null);
    const { error } = await generateInvoice({
      studentId,
      periodStart: invStart,
      periodEnd: invEnd,
      generatedByUserId: profile.id,
    });
    setInvSaving(false);
    if (error) { setInvError(error); return; }
    setShowInvoiceForm(false);
    reload();
  }

  async function handleGeneratePackageInvoice() {
    if (!studentId || !profile || selectedPackageIds.size === 0) return;
    setPkgInvoiceSaving(true);
    setPkgInvoiceError(null);
    const targetPackages = Array.from(selectedPackageIds)
      .map((id) => packageById.get(id))
      .filter((p): p is PackageWithTopups => !!p)
      .map((p) => ({ id: p.id, courseTypeId: p.course_type_id, createdAt: p.created_at }));
    const { error } = await generateInvoiceForPackages({
      studentId,
      generatedByUserId: profile.id,
      packages: targetPackages,
    });
    setPkgInvoiceSaving(false);
    if (error) { setPkgInvoiceError(error); return; }
    setShowPkgInvoiceForm(false);
    setSelectedPackageIds(new Set());
    reload();
  }

  // Locking must never freeze stale numbers — a report's totals are snapshotted
  // at generation and Lock alone doesn't re-pull live data, so sessions logged
  // between generating and locking would be dropped. This regenerates the draft
  // in place from the latest sessions first, opens the row so the admin sees
  // the refreshed totals, and only then asks them to confirm the lock (mirrors
  // AdminReportsPage's monthly-report startLockWithRefresh).
  async function startLockInvoiceWithRefresh(inv: InvoiceWithItems) {
    if (!profile || !student) return;
    setLockError(null);
    setLockingInvoiceId(inv.id);
    const pkgs = inv.invoice_packages.map((ip) => {
      const p = packageById.get(ip.student_package_id);
      return {
        id: ip.student_package_id,
        courseTypeId: p?.course_type_id ?? 0,
        createdAt: p?.created_at ?? undefined,
      };
    });
    const { error } = await regenerateInvoice({ invoice: inv, packages: pkgs, generatedByUserId: profile.id });
    setLockingInvoiceId(null);
    if (error) { setLockError(error); return; }
    const invs = await fetchInvoicesForStudent(student.id);
    setInvoices(invs);
    const refreshed = invs.find((i) => i.id === inv.id) ?? inv;
    setForceOpenInvoiceId(inv.id);
    setPendingLockInvoice(refreshed);
  }

  async function confirmLockInvoice() {
    if (!pendingLockInvoice || !profile) return;
    const inv = pendingLockInvoice;
    setLockError(null);
    setLockingInvoiceId(inv.id);
    const { error } = await lockInvoice({ invoiceId: inv.id, lockedByUserId: profile.id });
    setLockingInvoiceId(null);
    setPendingLockInvoice(null);
    if (error) { setLockError(error); return; }
    reload();
  }

  async function handleTogglePublish(inv: InvoiceWithItems) {
    if (!profile) return;
    setLockError(null);
    setPublishingInvoiceId(inv.id);
    const { error } = await setInvoicePublished({
      invoiceId: inv.id,
      publish: !inv.published_to_student_at,
      userId: profile.id,
    });
    setPublishingInvoiceId(null);
    if (error) { setLockError(error); return; }
    reload();
  }

  function handleDeleteInvoice(inv: InvoiceWithItems) {
    setDeleteError(null);
    setPendingDeleteInvoice(inv);
  }

  async function confirmDeleteInvoice() {
    if (!pendingDeleteInvoice) return;
    setDeletingInvoiceId(pendingDeleteInvoice.id);
    const { error } = await deleteInvoice(pendingDeleteInvoice.id);
    setDeletingInvoiceId(null);
    if (error) { setDeleteError(error); return; }
    setPendingDeleteInvoice(null);
    reload();
  }

  function downloadCsv(rows: string[][], filename: string) {
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Downloads the exact session-log detail behind one invoice as a CSV —
  // for a package invoice, filtered precisely to the course type(s) it
  // covers (so other packages active in the same date window aren't
  // included); for a date invoice, filtered to its date range.
  async function handleDownloadInvoiceSessionLog(inv: InvoiceWithItems) {
    if (!student) return;
    let rows: SessionLogDetailed[];
    if (inv.invoice_packages.length > 0) {
      const packageIds = inv.invoice_packages.map((ip) => ip.student_package_id);
      const courseTypeIds = inv.invoice_packages
        .map((ip) => packageById.get(ip.student_package_id)?.course_type_id)
        .filter((id): id is number => id != null);
      rows = await fetchSessionLogsForPackages({ studentId: student.id, packageIds, courseTypeIds });
    } else {
      rows = await fetchSessionLogsForDateRange({ studentId: student.id, periodStart: inv.period_start, periodEnd: inv.period_end });
    }
    const studentDisplay = `${student.id} — ${student.first_name} ${student.last_name}`;
    const headers = ["Student", "Date", "Teacher", "Subject", "Curriculum", "Hours", "Status", "Fathom Link"];
    const csvRows = rows.map((s) => {
      const subj = s.subject_id != null ? subjectLookup.get(s.subject_id) : undefined;
      return [
        studentDisplay,
        new Date(s.session_date).toLocaleDateString("en-GB"),
        s.teacher_id != null ? (teacherLookup.get(s.teacher_id) ?? "—") : "—",
        subj ? subjectLabel(subj.name, subj.level) : "—",
        s.curriculum_id != null ? (curriculumLookup.get(s.curriculum_id) ?? "—") : "—",
        String(s.session_duration_hrs ?? 0),
        s.no_show_type ? (NO_SHOW_LABELS[s.no_show_type] ?? s.no_show_type) : "Completed",
        s.video_link ?? "",
      ];
    });
    downloadCsv([headers, ...csvRows], `session-log_${student.id}_report-${inv.id}.csv`);
  }

  if (loadingStudent) {
    return <div className="flex items-center gap-2 text-navy-300 py-12"><Spinner /> Loading…</div>;
  }

  if (!student) {
    return <p className="text-sm text-navy-400 py-12">Student not found.</p>;
  }

  const fullName = `${student.first_name} ${student.last_name}`;
  // Stable non-null id for the deep-links built inside renderPoolCard (where
  // `student` is back to its nullable state type through the closure).
  const linkStudentId = student.id;

  // Group pools by their bundle (package_type_id) so a Foundation Program /
  // All-In-One student's pools show under one heading instead of as loose,
  // identically-named Beyond Academic cards.
  const bundleGroups = new Map<number, PackageWithTopups[]>();
  const standalonePkgs: PackageWithTopups[] = [];
  for (const p of packages) {
    if (p.package_type_id != null) {
      const arr = bundleGroups.get(p.package_type_id) ?? [];
      arr.push(p);
      bundleGroups.set(p.package_type_id, arr);
    } else {
      standalonePkgs.push(p);
    }
  }

  function renderPoolCard(pkg: PackageWithTopups) {
    const ct = courseTypes.find((c) => c.id === pkg.course_type_id);
    const hoursUsed = pkg.hours_used;
    const hoursRemaining = pkg.total_hours_purchased - hoursUsed;
    const pctUsed = pkg.total_hours_purchased > 0 ? hoursUsed / pkg.total_hours_purchased : 0;
    const expanded = expandedTopups.has(pkg.id);
    const pkgSessions = sessions.filter((s) => s.student_package_id === pkg.id);
    const subjectBreakdown = computeHoursUsedBySubject(pkgSessions);
    const teacherBreakdown = computeHoursUsedByTeacher(pkgSessions);

    return (
      <div key={pkg.id} className="border border-navy-100 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${courseTypeBadge(ct?.color ?? null)}`}>
            {pkg.pool_label ?? ct?.name ?? `Type ${pkg.course_type_id}`}
          </span>
          <span className={`text-sm font-bold ${pctUsed >= 0.9 ? "text-red-600" : pctUsed >= 0.75 ? "text-yellow-600" : "text-green-600"}`}>
            {formatHours(hoursRemaining)} hrs remaining
          </span>
        </div>
        <BalanceBar used={hoursUsed} total={pkg.total_hours_purchased} />
        {pctUsed >= 0.75 && (
          <p className={`text-xs mt-1 ${pctUsed >= 0.9 ? "text-red-500" : "text-yellow-500"}`}>
            {pctUsed >= 0.9 ? "Package almost depleted — consider renewing" : "Package running low"}
          </p>
        )}

        {(subjectBreakdown.length > 0 || teacherBreakdown.length > 0) && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-navy-50 pt-3">
            <div className="border border-navy-50 rounded-lg overflow-hidden">
              <p className="text-xs font-semibold text-navy-500 bg-navy-50/60 px-2.5 py-1.5">By subject</p>
              <div className="divide-y divide-navy-50">
                {subjectBreakdown.map((s) => {
                  const subj = subjectLookup.get(s.subjectId);
                  const label = subj ? subjectLabel(subj.name, subj.level) : `Subject ${s.subjectId}`;
                  const curriculum = s.curriculumId != null ? curriculumLookup.get(s.curriculumId) : null;
                  return (
                    <button
                      key={`${s.subjectId}:${s.curriculumId ?? ""}`}
                      onClick={() => {
                        const params = new URLSearchParams({ student: linkStudentId, subject: String(s.subjectId) });
                        if (s.curriculumId != null) params.set("curriculum", String(s.curriculumId));
                        navigate(`${sessionLogsBasePath}?${params.toString()}`);
                      }}
                      className="w-full flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 text-left hover:bg-sky-50/60 transition-colors"
                    >
                      <span className="text-navy-700 font-medium">
                        {label}{curriculum ? <span className="text-navy-400 font-normal"> ({curriculum})</span> : ""}
                      </span>
                      <span className="text-navy-400 tabular-nums shrink-0 whitespace-nowrap">
                        {formatHours(s.hours)} hrs · {sessionCountLabel(s.sessionCount, s.noShowCount)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="border border-navy-50 rounded-lg overflow-hidden">
              <p className="text-xs font-semibold text-navy-500 bg-navy-50/60 px-2.5 py-1.5">By teacher</p>
              <div className="divide-y divide-navy-50">
                {teacherBreakdown.map((t) => (
                  <button
                    key={t.teacherId}
                    onClick={() => {
                      const params = new URLSearchParams({ student: linkStudentId, teacher: String(t.teacherId) });
                      navigate(`${sessionLogsBasePath}?${params.toString()}`);
                    }}
                    className="w-full flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 text-left hover:bg-sky-50/60 transition-colors"
                  >
                    <span className="text-navy-700 font-medium">
                      {teacherLookup.get(t.teacherId) ?? `Teacher ${t.teacherId}`}
                    </span>
                    <span className="text-navy-400 tabular-nums shrink-0 whitespace-nowrap">
                      {formatHours(t.hours)} hrs · {sessionCountLabel(t.sessionCount, t.noShowCount)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-3 flex-wrap">
          {pkg.package_topups.length > 0 && (
            <button
              onClick={() => setExpandedTopups((s) => {
                const n = new Set(s);
                n.has(pkg.id) ? n.delete(pkg.id) : n.add(pkg.id);
                return n;
              })}
              className="text-xs text-navy-400 hover:text-navy-600"
            >
              {expanded ? "▲" : "▼"} {pkg.package_topups.length} top-up{pkg.package_topups.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>

        {expanded && (
          <div className="mt-3 space-y-1 border-t border-navy-50 pt-3">
            {[...pkg.package_topups]
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .map((t) => (
                <div key={t.id} className="flex items-start justify-between text-xs text-navy-600">
                  <div>
                    <span className="font-medium">+{t.hours_added} hrs</span>
                    <span className="text-navy-400 ml-2">({t.package_size_label})</span>
                    {t.note && <span className="text-navy-400 ml-2 italic">{t.note}</span>}
                  </div>
                  <span className="text-navy-400 shrink-0 ml-4">
                    {new Date(t.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="mb-4">
        <button
          onClick={() => navigate(backPath)}
          className="text-sm text-sky-500 hover:text-sky-700 mb-2 flex items-center gap-1"
        >
          ← {backLabel}
        </button>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold text-sky-500 bg-sky-50 border border-sky-100 px-2 py-1 rounded-lg">{student.id}</span>
          <h1 className="text-2xl font-bold text-navy-700">{fullName}</h1>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-navy-100 mb-6">
        {(["details", "packages", "homework", "coordinatorLog", "invoices"] as Tab[]).map((tab) => {
          const labels: Record<Tab, string> = {
            details: "Details",
            packages: "Learner's actual hours",
            homework: "Homework",
            coordinatorLog: "Performance Coach Log",
            invoices: "Reports",
          };
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? "border-sky-500 text-sky-600"
                  : "border-transparent text-navy-400 hover:text-navy-600 hover:border-navy-200"
              }`}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {/* ── Details tab ── */}
      {activeTab === "details" && (
        <div className="space-y-6 max-w-4xl">
        {/* One edit control for all three cards below, rather than a
            separate edit affordance per card. */}
        <div className="flex items-center justify-end gap-4">
          {!editingContact ? (
            <>
              <button onClick={handleDownloadInvoice} className="text-sm text-sky-500 hover:text-sky-700">
                Download Report
              </button>
              {/* Contact/account edits are admin-only — a PC sees the same
                  rich read-only layout but cannot change it. */}
              {isAdmin && (
                <button onClick={startEditContact} className="text-sm text-sky-500 hover:text-sky-700">Edit</button>
              )}
            </>
          ) : (
            <>
              <Button onClick={saveContact} disabled={contactSaving}>{contactSaving ? "Saving…" : "Save"}</Button>
              <Button variant="ghost" onClick={() => setEditingContact(false)}>Cancel</Button>
            </>
          )}
        </div>
        {editingContact && contactError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 -mt-3">{contactError}</p>
        )}

        {/* One consolidated box holds every detail now — student account,
            contact info, and the guardian's name/phone (there is no separate
            parent account anymore). */}
        <Card className="p-5">
          <p className="font-semibold text-navy-700 mb-4">Student Information</p>

          {editingContact ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextInput
                  label="First name"
                  value={contactForm.first_name}
                  onChange={(e) => setContactForm((f) => ({ ...f, first_name: e.target.value }))}
                />
                <TextInput
                  label="Last name"
                  value={contactForm.last_name}
                  onChange={(e) => setContactForm((f) => ({ ...f, last_name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextInput
                  label="Student email (login)"
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                />
                <TextInput
                  label="Send updates to (email)"
                  type="email"
                  value={contactForm.notification_email}
                  onChange={(e) => setContactForm((f) => ({ ...f, notification_email: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-navy-500 mb-1">Curriculum</label>
                  <select
                    value={contactForm.curriculum}
                    onChange={(e) => setContactForm((f) => ({ ...f, curriculum: e.target.value }))}
                    className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  >
                    <option value="">Select…</option>
                    {CURRICULUM_OPTIONS.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </div>
                <TextInput
                  label="School"
                  value={contactForm.school}
                  onChange={(e) => setContactForm((f) => ({ ...f, school: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-navy-500 mb-1">Graduation year</label>
                  <select
                    value={contactForm.graduation_year}
                    onChange={(e) => setContactForm((f) => ({ ...f, graduation_year: e.target.value }))}
                    className="w-full rounded-lg border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  >
                    <option value="">Select…</option>
                    {GRADUATION_YEARS.map((y) => (<option key={y} value={y}>{y}</option>))}
                  </select>
                </div>
                <TextInput
                  label="Birthday"
                  type="date"
                  value={contactForm.birthday}
                  onChange={(e) => setContactForm((f) => ({ ...f, birthday: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Student phone number</label>
                <div className="flex gap-2">
                  <select
                    value={contactForm.phone_code}
                    onChange={(e) => setContactForm((f) => ({ ...f, phone_code: e.target.value }))}
                    className="rounded-xl border border-navy-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 w-36"
                  >
                    {COUNTRY_CODES.map((c) => (<option key={c.code} value={c.code}>{c.code} {c.name}</option>))}
                  </select>
                  <input
                    type="tel"
                    value={contactForm.phone_num}
                    onChange={(e) => setContactForm((f) => ({ ...f, phone_num: e.target.value }))}
                    placeholder="50 123 4567"
                    className="flex-1 rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Country</label>
                <select
                  value={contactForm.country}
                  onChange={(e) => {
                    const next = e.target.value;
                    const dial = COUNTRY_TO_DIAL_CODE[next];
                    setContactForm((f) => ({ ...f, country: next, phone_code: dial ?? f.phone_code }));
                  }}
                  className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  {COUNTRIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <TextInput
                label="Address"
                value={contactForm.address}
                onChange={(e) => setContactForm((f) => ({ ...f, address: e.target.value }))}
              />

              <div className="border-t border-navy-50 pt-3">
                <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">Parent / Guardian</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextInput
                    label="Parent/Guardian name"
                    value={contactForm.parent_full_name}
                    onChange={(e) => setContactForm((f) => ({ ...f, parent_full_name: e.target.value }))}
                  />
                  <div>
                    <label className="block text-xs font-medium text-navy-500 mb-1">Parent/Guardian phone</label>
                    <div className="flex gap-2">
                      <select
                        value={contactForm.parent_phone_code}
                        onChange={(e) => setContactForm((f) => ({ ...f, parent_phone_code: e.target.value }))}
                        className="rounded-xl border border-navy-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 w-36"
                      >
                        {COUNTRY_CODES.map((c) => (<option key={c.code} value={c.code}>{c.code} {c.name}</option>))}
                      </select>
                      <input
                        type="tel"
                        value={contactForm.parent_phone_num}
                        onChange={(e) => setContactForm((f) => ({ ...f, parent_phone_num: e.target.value }))}
                        placeholder="50 123 4567"
                        className="flex-1 rounded-xl border border-navy-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Read-only — assigned/generated elsewhere in the app, not editable here. */}
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm pt-2 border-t border-navy-50">
                <div className="flex gap-2">
                  <dt className="text-navy-400 w-36 shrink-0">Student ID</dt>
                  <dd className="text-navy-700 font-medium">{student.id}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-navy-400 w-36 shrink-0">Username</dt>
                  <dd className="text-navy-700 font-medium">{studentUsername ?? <span className="text-navy-300 italic">No login account</span>}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-navy-400 w-36 shrink-0">Performance Coach</dt>
                  <dd className="text-navy-700 font-medium">
                    {(() => {
                      const pcId = getPcForStudent(student.id);
                      const pcName = pcId != null ? teacherLookup.get(pcId) : null;
                      return pcName ?? <span className="text-amber-600">Unassigned</span>;
                    })()}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-navy-400 w-36 shrink-0">Student added date</dt>
                  <dd className="text-navy-700 font-medium">{new Date(student.created_at).toLocaleDateString()}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {([
                ["Student ID", student.id],
                ["Username", studentUsername],
                ["First name", student.first_name],
                ["Last name", student.last_name],
                ["Student email (login)", student.email],
                ["Send updates to", student.notification_email],
                ["Curriculum", student.curriculum],
                ["School", student.school],
                ["Graduation year", student.graduation_year != null ? String(student.graduation_year) : null],
                ["Birthday", student.birthday ? new Date(student.birthday).toLocaleDateString() : null],
                ["Student Phone", student.phone_number],
                ["Address", student.address],
                ["Country", student.country],
                ["Parent/Guardian name", student.parent_full_name],
                ["Parent/Guardian Phone", student.parent_phone_number],
                ["Student added date", new Date(student.created_at).toLocaleDateString()],
              ] as [string, string | null][]).map(([label, val]) => (
                <div key={label} className="flex gap-2">
                  <dt className="text-navy-400 w-36 shrink-0">{label}</dt>
                  <dd className="text-navy-700 font-medium break-all">{val ?? <span className="text-navy-300 italic">{label === "Username" ? "No login account" : "—"}</span>}</dd>
                </div>
              ))}
              <div className="flex gap-2">
                <dt className="text-navy-400 w-36 shrink-0">Performance Coach</dt>
                <dd className="text-navy-700 font-medium">
                  {(() => {
                    const pcId = getPcForStudent(student.id);
                    const pcName = pcId != null ? teacherLookup.get(pcId) : null;
                    return pcName ?? <span className="text-amber-600">Unassigned</span>;
                  })()}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-navy-400 w-36 shrink-0">Report card</dt>
                <dd className="text-navy-700 font-medium break-all">
                  {reportCardUrl ? (
                    <a href={reportCardUrl} target="_blank" rel="noreferrer" className="text-sky-500 hover:text-sky-700 underline">View / download</a>
                  ) : (
                    <span className="text-navy-300 italic">—</span>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </Card>
        </div>
      )}

      {/* ── Learner's actual hours tab ── */}
      {activeTab === "packages" && (
        <Card className="p-5">
          {/* Renewing / adding hours goes through the admin-only enroll →
              invoice → confirm flow — a PC has no direct-add path at all. */}
          {isAdmin && (
            <div className="flex items-center justify-end mb-4">
              <button
                onClick={() => navigate(`/admin/students/enroll?student=${student.id}`)}
                className="text-sm text-sky-500 hover:text-sky-700"
              >
                Renew / Add hours →
              </button>
            </div>
          )}

          {/* Quick "hours used per subject across all teachers" summary — an
              at-a-glance total that doesn't need a report generated. Shown as
              a plain readable list (one subject per row) rather than a dense
              wall of pills. */}
          {!loadingPackages && hoursBySubject.length > 0 && (
            <div className="mb-5 border border-navy-100 rounded-xl overflow-hidden">
              <p className="text-sm font-semibold text-navy-700 px-4 py-2.5 bg-navy-50/60">Hours used by subject</p>
              <ul className="divide-y divide-navy-50">
                {hoursBySubject.map((h) => {
                  const subj = subjectLookup.get(h.subjectId);
                  const subName = subj ? subjectLabel(subj.name, subj.level) : `#${h.subjectId}`;
                  const curName = h.curriculumId ? curriculumLookup.get(h.curriculumId) : null;
                  const label = curName ? `${curName} – ${subName}` : subName;
                  return (
                    <li
                      key={`${h.subjectId}:${h.curriculumId ?? ""}`}
                      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <span className="text-navy-700 font-medium">{label}</span>
                      <span className="text-navy-500 tabular-nums shrink-0 whitespace-nowrap">{formatHours(h.hours)} hrs</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Pending Deduction — sessions with more than one candidate pool
              and no resolution yet; a PC must pick which one they count
              against. Hidden entirely once there's nothing pending. */}
          {pendingSessions.length > 0 && (
            <div className="mb-5 border border-amber-200 bg-amber-50 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-1">Pending Deduction — {pendingSessions.length} session{pendingSessions.length !== 1 ? "s" : ""} need a package chosen</p>
              <p className="text-xs text-amber-700 mb-3">This student has more than one active pool for the same package type. Pick which one each session below should count against.</p>
              {poolActionError && <p className="text-xs text-red-600 mb-2">{poolActionError}</p>}
              <div className="space-y-2">
                {pendingSessions.map((log) => {
                  const candidatePools = packages.filter((p) => p.course_type_id === log.course_type_id && !p.is_locked);
                  const ct = courseTypes.find((c) => c.id === log.course_type_id);
                  return (
                    <div key={log.id} className="flex items-center gap-3 bg-white border border-amber-100 rounded-lg px-3 py-2 text-xs flex-wrap">
                      <span className={`font-semibold px-2 py-0.5 rounded-full border shrink-0 ${courseTypeBadge(ct?.color ?? null)}`}>{ct?.name ?? "Package"}</span>
                      <span className="text-navy-600">{new Date(log.session_date).toLocaleDateString("en-GB")}</span>
                      <span className="text-navy-500">{log.teacher ? `${log.teacher.first_name} ${log.teacher.last_name ?? ""}`.trim() : "—"}</span>
                      <span className="text-navy-500">
                        {sessionTopicLabel({
                          subjectName: log.subject?.name,
                          topic: log.topic,
                          programName: log.program_type_id != null ? programTypes.find((p) => p.id === log.program_type_id)?.name : null,
                        })}
                      </span>
                      <span className="text-navy-500 tabular-nums">{formatHours(log.session_duration_hrs ?? 0)} hrs</span>
                      <select
                        value={pendingChoice.get(log.id) ?? ""}
                        onChange={(e) => setPendingChoice((m) => new Map(m).set(log.id, Number(e.target.value)))}
                        className="ml-auto rounded-lg border border-navy-100 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                      >
                        <option value="" disabled>Choose pool…</option>
                        {candidatePools.map((p) => (
                          <option key={p.id} value={p.id}>{p.pool_label ?? "General"} ({formatHours(p.total_hours_purchased)} hrs)</option>
                        ))}
                      </select>
                      <Button
                        onClick={() => resolvePending(log.id)}
                        disabled={!pendingChoice.get(log.id) || poolActionBusyId === log.id}
                      >
                        {poolActionBusyId === log.id ? "…" : "Assign"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Teacher/Subject → Project assignments — the sticky (teacher,
              subject) -> pool cache. Shown whenever the student has any
              active pool, so an admin/PC can set one up proactively (before
              any session has even been logged), not just once a session has
              come in ambiguous. Changing/adding a rule here only ever
              affects a brand-new session logged from now on, plus any
              currently-pending (not-yet-deducted) session matching the same
              key — already-resolved sessions keep whatever pool they were
              already counted against (enforced by the DB trigger, not just
              the UI). */}
          {(packages.some((p) => !p.is_locked) || poolResolutions.length > 0) && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                {poolResolutions.length > 0 ? (
                  <button
                    onClick={() => setShowPoolResolutions((v) => !v)}
                    className="text-xs text-navy-400 hover:text-navy-600"
                  >
                    {showPoolResolutions ? "▲" : "▼"} {poolResolutions.length} teacher/subject → project assignment{poolResolutions.length !== 1 ? "s" : ""}
                  </button>
                ) : (
                  <span className="text-xs text-navy-400">No teacher/subject → project assignments yet</span>
                )}
                {!showAddResolution && (
                  <button onClick={openAddResolution} className="text-xs text-sky-500 hover:text-sky-700 font-medium">
                    + Add assignment
                  </button>
                )}
              </div>

              {showPoolResolutions && poolResolutions.length > 0 && (
                <div className="border border-navy-100 rounded-xl p-3 space-y-1.5 mb-2">
                  {poolResolutions.map((r) => {
                    const candidatePools = packages.filter((p) => p.course_type_id === r.student_package?.course_type_id && !p.is_locked);
                    const isEditingRow = editingResolutionId === r.id;
                    return (
                    <div key={r.id} className="flex items-center gap-2 text-xs bg-navy-50/60 rounded-lg px-2.5 py-1.5 flex-wrap">
                      <span className="text-navy-600">{r.teacher ? `${r.teacher.first_name} ${r.teacher.last_name ?? ""}`.trim() : "—"}</span>
                      <span className="text-navy-400">·</span>
                      <span className="text-navy-500">{r.subject?.name ?? "Any subject"}</span>
                      <span className="text-navy-400">→</span>
                      {isEditingRow ? (
                        <>
                          <select
                            value={r.student_package_id}
                            disabled={poolActionBusyId === r.id}
                            onChange={(e) => changeResolutionTarget(r.id, Number(e.target.value))}
                            className="rounded-lg border border-navy-100 px-2 py-0.5 text-xs font-medium text-navy-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                          >
                            {candidatePools.map((p) => (
                              <option key={p.id} value={p.id}>{p.pool_label ?? "General"}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => setEditingResolutionId(null)}
                            disabled={poolActionBusyId === r.id}
                            className="text-navy-400 hover:text-navy-600"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="font-medium text-navy-700">{r.student_package?.pool_label ?? "General"}</span>
                          <button
                            onClick={() => setEditingResolutionId(r.id)}
                            className="text-sky-500 hover:text-sky-700 font-medium"
                          >
                            Edit
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => resetPoolResolution(r.id)}
                        disabled={poolActionBusyId === r.id}
                        title="Delete this assignment — sessions already logged against it are unaffected, only future ones go back to needing a manual choice"
                        className="ml-auto text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {poolActionBusyId === r.id ? "…" : "Delete"}
                      </button>
                    </div>
                    );
                  })}
                </div>
              )}

              {showAddResolution && (() => {
                const selectedPool = newResolutionPoolId === "" ? null : packages.find((p) => p.id === newResolutionPoolId);
                const selectedCt = selectedPool ? courseTypes.find((c) => c.id === selectedPool.course_type_id) : null;
                const hasSubjects = selectedCt?.name === "Academic" || selectedCt?.name === "Beyond Academic" || selectedCt?.name === "College Counselling";
                // Once a teacher is chosen, only offer subjects that teacher is
                // actually assigned to teach — not every subject that exists
                // under the project's course type — so the dropdown can't
                // produce a (teacher, subject) pair the teacher doesn't teach.
                const selectedTeacherSubjectIds = newResolutionTeacherId === ""
                  ? null
                  : new Set((subjectsByTeacher.get(newResolutionTeacherId) ?? []).map((s) => s.subject_id));
                const candidateSubjects = candidateSubjectsForCourseType(selectedCt?.name, subjects).filter(
                  (s) => selectedTeacherSubjectIds == null || selectedTeacherSubjectIds.has(s.id)
                );
                return (
                  <div className="border border-sky-100 rounded-xl p-3 bg-sky-50 space-y-2">
                    <p className="text-xs font-semibold text-navy-700">Add teacher/subject → project assignment</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] text-navy-500 mb-1">Project</label>
                        <select
                          value={newResolutionPoolId}
                          onChange={(e) => { setNewResolutionPoolId(e.target.value ? Number(e.target.value) : ""); setNewResolutionSubjectId(""); }}
                          className="w-full rounded-lg border border-navy-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                        >
                          <option value="" disabled>Select a project…</option>
                          {packages.filter((p) => !p.is_locked).map((p) => {
                            const bundleCt = p.package_type_id != null ? courseTypes.find((c) => c.id === p.package_type_id) : null;
                            const ct = courseTypes.find((c) => c.id === p.course_type_id);
                            const label = bundleCt
                              ? `${bundleCt.name} — ${p.pool_label ?? ct?.name ?? "General"}`
                              : (p.pool_label ?? ct?.name ?? `Type ${p.course_type_id}`);
                            return <option key={p.id} value={p.id}>{label}</option>;
                          })}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-navy-500 mb-1">Teacher</label>
                        <select
                          value={newResolutionTeacherId}
                          onChange={(e) => { setNewResolutionTeacherId(e.target.value ? Number(e.target.value) : ""); setNewResolutionSubjectId(""); }}
                          className="w-full rounded-lg border border-navy-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                        >
                          <option value="" disabled>Select a teacher…</option>
                          {teachers.filter((t) => t.is_active).map((t) => (
                            <option key={t.id} value={t.id}>{t.first_name} {t.last_name ?? ""}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-navy-500 mb-1">Subject</label>
                        {!selectedPool ? (
                          <select disabled className="w-full rounded-lg border border-navy-100 px-2 py-1.5 text-xs text-navy-300 bg-navy-50">
                            <option>Pick a project first…</option>
                          </select>
                        ) : !hasSubjects ? (
                          <p className="text-[11px] text-navy-400 italic px-1 py-1.5">No subjects for this project — applies to any session from this teacher.</p>
                        ) : newResolutionTeacherId === "" ? (
                          <select disabled className="w-full rounded-lg border border-navy-100 px-2 py-1.5 text-xs text-navy-300 bg-navy-50">
                            <option>Pick a teacher first…</option>
                          </select>
                        ) : candidateSubjects.length === 0 ? (
                          <p className="text-[11px] text-navy-400 italic px-1 py-1.5">This teacher has no {selectedCt?.name} subjects assigned — set them up under Teacher Subjects first.</p>
                        ) : (
                          <select
                            value={newResolutionSubjectId}
                            onChange={(e) => setNewResolutionSubjectId(e.target.value ? Number(e.target.value) : "")}
                            className="w-full rounded-lg border border-navy-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                          >
                            <option value="">Any subject</option>
                            {candidateSubjects.map((s) => (
                              <option key={s.id} value={s.id}>{subjectLabel(s.name, s.level)}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                    {addResolutionError && <p className="text-xs text-red-600">{addResolutionError}</p>}
                    <div className="flex gap-2">
                      <Button onClick={handleAddResolution} disabled={addResolutionSaving || newResolutionPoolId === "" || newResolutionTeacherId === ""}>
                        {addResolutionSaving ? "Saving…" : "Add assignment"}
                      </Button>
                      <Button variant="ghost" onClick={closeAddResolution}>Cancel</Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {loadingPackages ? (
            <div className="flex items-center gap-2 text-navy-300 text-sm"><Spinner /></div>
          ) : packages.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-navy-400 mb-1">No packages yet.</p>
              <p className="text-xs text-navy-400 mb-3">
                Hours are added by sending an invoice and confirming payment — they can't be entered directly here.
              </p>
              {isAdmin && (
                <Button onClick={() => navigate(`/admin/students/enroll?student=${student.id}`)}>Send renewal invoice</Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from(bundleGroups.entries()).map(([packageTypeId, pools]) => {
                const bundleCt = courseTypes.find((c) => c.id === packageTypeId);
                return (
                  <div key={`bundle-${packageTypeId}`} className="space-y-2">
                    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${courseTypeBadge(bundleCt?.color ?? null)}`}>
                      {bundleCt?.name ?? "Bundle"}
                    </span>
                    <div className="space-y-4 pl-3 border-l-2 border-navy-50">
                      {pools.map(renderPoolCard)}
                    </div>
                  </div>
                );
              })}
              {standalonePkgs.map(renderPoolCard)}
            </div>
          )}
        </Card>
      )}

      {/* ── Homework tab ── */}
      {activeTab === "homework" && (
        <Card className="p-5">
          <p className="font-semibold text-navy-700 mb-4">Homework</p>
          {/* Both roles can open a paper: a PC into the full review/grading
              page (/teacher/homework/:id), an admin into a read-only view
              (/admin/homework/:id). */}
          <HomeworkResultsList
            studentId={studentId}
            subjectName={subjectName}
            teacherName={(id) => (id != null ? (teacherLookup.get(id) ?? null) : null)}
            linkable
            linkBase={isAdmin ? "/admin/homework" : "/teacher/homework"}
          />
        </Card>
      )}

      {/* ── Coordinator's Log tab ── */}
      {activeTab === "coordinatorLog" && (
        <Card className="p-5">
          <CoordinatorLogHistoryList
            studentId={studentId}
            addLogPath={isAdmin ? "/admin/coordinator-logs/new" : "/teacher/coordinator-logs/new"}
            listPath={isAdmin ? "/admin/coordinator-logs" : "/teacher/coordinator-logs"}
          />
        </Card>
      )}

      {/* ── Reports tab ── */}
      {activeTab === "invoices" && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="font-semibold text-navy-700">Reports</p>
            <div className="flex items-center gap-4">
              {lockError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 max-w-md">{lockError}</p>
              )}
              {!showPkgInvoiceForm && (
                <button
                  onClick={() => {
                    setSelectedPackageIds(new Set());
                    setPkgInvoiceError(null);
                    setShowPkgInvoiceForm(true);
                    setShowInvoiceForm(false);
                  }}
                  className="text-sm text-sky-500 hover:text-sky-700"
                >
                  + Generate by package
                </button>
              )}
              {!showInvoiceForm && (
                <button
                  onClick={() => {
                    const now = new Date();
                    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
                    setInvStart(firstOfMonth);
                    setInvEnd(toLocalDateString(now));
                    setInvError(null);
                    setShowInvoiceForm(true);
                    setShowPkgInvoiceForm(false);
                  }}
                  className="text-sm text-sky-500 hover:text-sky-700"
                >
                  + Generate by date
                </button>
              )}
            </div>
          </div>

          {showPkgInvoiceForm && (
            <div className="mb-4 p-4 border border-sky-100 rounded-xl bg-sky-50">
              <p className="text-sm font-semibold text-navy-700 mb-1">Generate report by package</p>
              <p className="text-xs text-navy-400 mb-3">
                Covers every session ever logged against the selected package(s). Foundation Program / All-In-One report as one bundle, covering all their pools together.
              </p>
              {packages.length === 0 ? (
                <p className="text-sm text-navy-400">No packages to report on.</p>
              ) : (
                <div className="space-y-1.5 mb-3">
                  {/* Foundation Program / All-In-One report as ONE unit — a
                      single checkbox covering all the bundle's pools, so the
                      report is the full bundle, not one row per Beyond
                      Academic pool. */}
                  {Array.from(bundleGroups.entries()).map(([packageTypeId, pools]) => {
                    const bundleCt = courseTypes.find((c) => c.id === packageTypeId);
                    const poolIds = pools.map((p) => p.id);
                    const allSelected = poolIds.every((id) => selectedPackageIds.has(id));
                    const totalUsed = pools.reduce((sum, p) => sum + p.hours_used, 0);
                    const totalPurchased = pools.reduce((sum, p) => sum + p.total_hours_purchased, 0);
                    return (
                      <label key={`bundle-${packageTypeId}`} className="flex items-center gap-2 text-xs cursor-pointer bg-white border border-navy-100 rounded-lg p-3">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => setSelectedPackageIds((s) => {
                            const n = new Set(s);
                            if (allSelected) poolIds.forEach((id) => n.delete(id));
                            else poolIds.forEach((id) => n.add(id));
                            return n;
                          })}
                        />
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${courseTypeBadge(bundleCt?.color ?? null)}`}>
                          {bundleCt?.name ?? "Bundle"}
                        </span>
                        <span className="text-navy-400">
                          {pools.length} pool{pools.length !== 1 ? "s" : ""} · {formatHours(totalUsed)} / {formatHours(totalPurchased)} hrs used
                        </span>
                      </label>
                    );
                  })}
                  {standalonePkgs.map((pkg) => {
                    const ct = courseTypes.find((c) => c.id === pkg.course_type_id);
                    const hoursUsed = pkg.hours_used;
                    return (
                      <label key={pkg.id} className="flex items-center gap-2 text-xs cursor-pointer bg-white border border-navy-100 rounded-lg p-3">
                        <input
                          type="checkbox"
                          checked={selectedPackageIds.has(pkg.id)}
                          onChange={() => setSelectedPackageIds((s) => {
                            const n = new Set(s);
                            n.has(pkg.id) ? n.delete(pkg.id) : n.add(pkg.id);
                            return n;
                          })}
                        />
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${courseTypeBadge(ct?.color ?? null)}`}>
                          {ct?.name ?? `Type ${pkg.course_type_id}`}
                        </span>
                        <span className="text-navy-400">
                          {formatHours(hoursUsed)} / {formatHours(pkg.total_hours_purchased)} hrs used
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {pkgInvoiceError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{pkgInvoiceError}</p>}
              <div className="flex gap-2">
                <Button onClick={handleGeneratePackageInvoice} disabled={pkgInvoiceSaving || selectedPackageIds.size === 0}>
                  {pkgInvoiceSaving ? "Generating…" : "Generate"}
                </Button>
                <Button variant="ghost" onClick={() => setShowPkgInvoiceForm(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {showInvoiceForm && (
            <div className="mb-4 p-4 border border-sky-100 rounded-xl bg-sky-50">
              <p className="text-sm font-semibold text-navy-700 mb-3">Generate report for period</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <TextInput label="Period start" type="date" value={invStart} onChange={(e) => setInvStart(e.target.value)} />
                <TextInput label="Period end"   type="date" value={invEnd}   onChange={(e) => setInvEnd(e.target.value)} />
              </div>
              {invError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{invError}</p>}
              <div className="flex gap-2">
                <Button onClick={handleGenerateInvoice} disabled={invSaving || !invStart || !invEnd}>
                  {invSaving ? "Generating…" : "Generate"}
                </Button>
                <Button variant="ghost" onClick={() => setShowInvoiceForm(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {invoices.length === 0 ? (
            <p className="text-sm text-navy-400">No reports generated yet.</p>
          ) : (
            <InvoiceList
              invoices={invoices}
              student={student}
              packageById={packageById}
              courseTypes={courseTypes}
              canLock={isAdmin}
              onLock={startLockInvoiceWithRefresh}
              lockingInvoiceId={lockingInvoiceId}
              forceOpenId={forceOpenInvoiceId}
              onTogglePublish={handleTogglePublish}
              publishingInvoiceId={publishingInvoiceId}
              onDelete={handleDeleteInvoice}
              deletingInvoiceId={deletingInvoiceId}
              onDownloadSessionLog={handleDownloadInvoiceSessionLog}
              sectionsFor={sectionsForLineItems}
            />
          )}
        </Card>
      )}

      <ConfirmDialog
        open={pendingLockInvoice !== null}
        title="Lock this report?"
        description="This report has just been refreshed with the latest session data — review the updated totals in the expanded row before confirming. Locking freezes it for good: session logs it covers can no longer be reflected, and the report itself can't be changed or removed."
        confirmLabel={pendingLockInvoice && lockingInvoiceId === pendingLockInvoice.id ? "Locking…" : "Lock"}
        isDangerous={false}
        onConfirm={confirmLockInvoice}
        onCancel={() => { setPendingLockInvoice(null); setForceOpenInvoiceId(null); }}
      />

      {pendingDeleteInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/40 px-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
            <p className="font-semibold text-navy-700 mb-2">Delete this draft report?</p>
            <p className="text-sm text-navy-500 mb-4">
              {new Date(pendingDeleteInvoice.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              {" – "}
              {new Date(pendingDeleteInvoice.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              {" · "}
              {formatHours(pendingDeleteInvoice.total_hours)} hrs — this cannot be undone.
            </p>
            {deleteError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{deleteError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setPendingDeleteInvoice(null)} disabled={deletingInvoiceId === pendingDeleteInvoice.id}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDeleteInvoice} disabled={deletingInvoiceId === pendingDeleteInvoice.id}>
                {deletingInvoiceId === pendingDeleteInvoice.id ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Invoice list with expandable line items ──────────────────────────────────
function InvoiceList({
  invoices,
  student,
  packageById,
  courseTypes,
  canLock,
  onLock,
  lockingInvoiceId,
  onTogglePublish,
  publishingInvoiceId,
  onDelete,
  deletingInvoiceId,
  onDownloadSessionLog,
  sectionsFor,
  forceOpenId,
}: {
  invoices: InvoiceWithItems[];
  student: Student;
  packageById: Map<number, PackageWithTopups>;
  courseTypes: { id: number; name: string }[];
  /** Only admins may lock a report; a PC never sees the Lock action. */
  canLock: boolean;
  onLock: (inv: InvoiceWithItems) => void;
  lockingInvoiceId: number | null;
  onTogglePublish: (inv: InvoiceWithItems) => void;
  publishingInvoiceId: number | null;
  onDelete: (inv: InvoiceWithItems) => void;
  deletingInvoiceId: number | null;
  onDownloadSessionLog: (inv: InvoiceWithItems) => void;
  sectionsFor: (lineItems: InvoiceLineItemWithNames[]) => ReportSection[];
  /** A row to force-open (e.g. after a lock-with-refresh) so its refreshed
   *  totals are visible before the admin confirms the lock. */
  forceOpenId?: number | null;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // When the parent asks to open a specific row (lock-with-refresh), reveal it.
  useEffect(() => {
    if (forceOpenId != null) {
      setExpanded((s) => { const n = new Set(s); n.add(forceOpenId); return n; });
    }
  }, [forceOpenId]);

  // Distinct package names covered by an invoice. A pool that belongs to a
  // Foundation Program / All-In-One bundle (package_type_id set) is shown by
  // its bundle name, so a bundle invoice reads "All-In-One" once rather than
  // "Beyond Academic, Beyond Academic, …, College Counselling".
  function invoicePackageNames(inv: InvoiceWithItems) {
    const names = inv.invoice_packages.map((ip) => {
      const pkg = packageById.get(ip.student_package_id);
      if (!pkg) return `Package ${ip.student_package_id}`;
      if (pkg.package_type_id != null) {
        return courseTypes.find((c) => c.id === pkg.package_type_id)?.name ?? "Bundle";
      }
      return courseTypes.find((c) => c.id === pkg.course_type_id)?.name ?? `Type ${pkg.course_type_id}`;
    });
    return Array.from(new Set(names));
  }

  const handleDownload = (inv: InvoiceWithItems) => {
    const { start, end } = getInvoiceDisplayDates(inv);
    buildSingleInvoicePdf({
      student,
      periodStart: start,
      periodEnd: end,
      totalHours: inv.total_hours,
      sections: sectionsFor(inv.invoice_line_items),
    });
  };

  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  // Newest-generated first within each section, so the report just created is
  // always #1 at the top — reports can otherwise look identical (same date
  // range/hours/package) with no other way to tell which is the new one.
  const byGeneratedDesc = (a: InvoiceWithItems, b: InvoiceWithItems) =>
    new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime();
  const dateInvoices = invoices.filter((inv) => inv.status !== "locked" && inv.invoice_packages.length === 0).sort(byGeneratedDesc);
  const packageDraftInvoices = invoices.filter((inv) => inv.status !== "locked" && inv.invoice_packages.length > 0).sort(byGeneratedDesc);
  const lockedInvoices = invoices.filter((inv) => inv.status === "locked").sort(byGeneratedDesc);

  // Single source of truth for the date range shown for an invoice, used by
  // both the list row and the downloaded PDF so they can never disagree.
  // Package invoices: start/end are the covered sessions' date range
  // (period_start/period_end, set at generation time). Date-range invoices
  // use the same fields — the only difference is whether packages are linked.
  function getInvoiceDisplayDates(inv: InvoiceWithItems) {
    return { start: inv.period_start, end: inv.period_end };
  }

  function renderRow(inv: InvoiceWithItems, position: number) {
    const isOpen = expanded.has(inv.id);
    const { start, end } = getInvoiceDisplayDates(inv);
    const toggleExpanded = () =>
      setExpanded((s) => { const n = new Set(s); n.has(inv.id) ? n.delete(inv.id) : n.add(inv.id); return n; });

    const actions: RowMenuAction[] = [
      { label: "Download report", onClick: () => handleDownload(inv) },
      { label: "Download session log", onClick: () => onDownloadSessionLog(inv) },
    ];
    if (inv.invoice_line_items.length > 0) {
      const count = inv.invoice_line_items.length;
      actions.push({
        label: isOpen ? "Hide line items" : `Show ${count} line${count !== 1 ? "s" : ""}`,
        onClick: toggleExpanded,
      });
    }
    const isPublished = !!inv.published_to_student_at;
    actions.push({
      label: publishingInvoiceId === inv.id ? "…" : isPublished ? "Unpublish" : "Publish",
      onClick: () => onTogglePublish(inv),
    });
    if (inv.status !== "locked") {
      if (canLock) {
        actions.push({ label: lockingInvoiceId === inv.id ? "Refreshing…" : "Lock", onClick: () => onLock(inv) });
      }
      actions.push({ label: deletingInvoiceId === inv.id ? "Deleting…" : "Delete", onClick: () => onDelete(inv), danger: true });
    }

    return (
      <div key={inv.id} className="border border-navy-100 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-white text-sm">
          <div>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-navy-100 text-navy-600 text-[11px] font-semibold mr-2.5 align-middle">
              {position}
            </span>
            <span className="font-medium text-navy-700">
              {fmtDate(start)}
              {" – "}
              {fmtDate(end)}
            </span>
            <span className="ml-3 text-navy-500">{formatHours(inv.total_hours)} hrs</span>
            {inv.invoice_packages.length > 0 && (() => {
              const names = invoicePackageNames(inv);
              return (
                <span className="ml-3 text-xs text-navy-400">
                  Package{names.length !== 1 ? "s" : ""}: {names.join(", ")}
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              isPublished ? "bg-sky-100 text-sky-700" : "bg-amber-50 text-amber-700"
            }`}>
              {isPublished ? "Published" : "Draft"}
            </span>
            {/* Lifecycle status is only worth showing when it adds something the
                Published/Draft badge and the section heading don't already —
                i.e. when the report is locked. "draft" here just duplicated the
                "Draft" badge next to it. */}
            {inv.status === "locked" && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-navy-600 text-white">
                🔒 locked
              </span>
            )}
            <RowMenu actions={actions} />
          </div>
        </div>
        {isOpen && (
          <div className="border-t border-navy-50 bg-navy-50 px-4 py-3">
            <ReportSectionsView sections={sectionsFor(inv.invoice_line_items)} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2">
          By date (drafts) — {dateInvoices.length}
        </p>
        {dateInvoices.length === 0 ? (
          <p className="text-sm text-navy-300 italic">None.</p>
        ) : (
          <div className="space-y-2">{dateInvoices.map((inv, i) => renderRow(inv, i + 1))}</div>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2">
          By package (drafts) — {packageDraftInvoices.length}
        </p>
        {packageDraftInvoices.length === 0 ? (
          <p className="text-sm text-navy-300 italic">None.</p>
        ) : (
          <div className="space-y-2">{packageDraftInvoices.map((inv, i) => renderRow(inv, i + 1))}</div>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide mb-2">
          Locked — {lockedInvoices.length}
        </p>
        {lockedInvoices.length === 0 ? (
          <p className="text-sm text-navy-300 italic">None.</p>
        ) : (
          <div className="space-y-2">{lockedInvoices.map((inv, i) => renderRow(inv, i + 1))}</div>
        )}
      </div>
    </div>
  );
}

